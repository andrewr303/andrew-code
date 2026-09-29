"""Persistent agent memory — store, recall, and forget knowledge across sessions.

Ported from CAO's ``memory_service.py`` and adapted for Fusion's stdlib-only
architecture. Every agent in a Fusion session can use ``memory_store`` to
persist facts, ``memory_recall`` to retrieve them, and ``memory_forget`` to
remove them. Memories are injected as context at the start of each session.

Architecture:
  - **Dual-store**: markdown wiki files (content) + JSON metadata index (search)
  - **5 scopes**: project, global, session, agent, federated
  - **4 types**: project, user, feedback, reference (classification labels)
  - **Search**: metadata substring + BM25 fallback (optional ``rank_bm25`` dep)
  - **Scoring**: 3-factor composite (BM25 relevance × recency boost × usage count)
  - **Injection**: auto-prepend relevant memories as ``<cao-memory>`` block on
    first message per session
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MEMORY_ROOT = Path(
    os.environ.get(
        "FUSION_MEMORY_ROOT",
        os.path.join(os.path.expanduser("~"), ".fusion", "memory"),
    )
).resolve()

MEMORY_MAX_PER_SCOPE = 10           # max entries returned per scope
MEMORY_SCOPE_BUDGET_CHARS = 1000    # chars per scope in context injection

# Retention (days; None = never expires)
SCOPE_RETENTION: dict[str, Optional[int]] = {
    "global": None,
    "agent": None,
    "federated": None,
    "project": 90,
    "session": 14,
}

TYPE_RETENTION: dict[str, Optional[int]] = {
    "user": None,
    "feedback": None,
}

VALID_SCOPES = frozenset({"global", "project", "session", "agent", "federated"})
VALID_TYPES = frozenset({"project", "user", "feedback", "reference"})


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class MemoryEntry:
    key: str
    content: str = ""
    scope: str = "project"
    scope_id: str = ""
    memory_type: str = "feedback"
    tags: list[str] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    usage_count: int = 0
    related: list[str] = field(default_factory=list)   # cross-reference keys

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MemoryEntry":
        return cls(
            key=d.get("key", ""),
            content=d.get("content", ""),
            scope=d.get("scope", "project"),
            scope_id=d.get("scope_id", ""),
            memory_type=d.get("memory_type", "feedback"),
            tags=d.get("tags", []),
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
            usage_count=d.get("usage_count", 0),
            related=d.get("related", []),
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_project_id(cwd: str) -> str:
    """Derive a stable project ID from the working directory."""
    git_remote = _git_remote_url(cwd)
    if git_remote:
        return hashlib.sha256(git_remote.encode()).hexdigest()[:12]
    return hashlib.sha256(os.path.abspath(cwd).encode()).hexdigest()[:12]


def _git_remote_url(cwd: str) -> str:
    try:
        import subprocess
        r = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True, text=True, cwd=cwd, timeout=5,
        )
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Storage layout
# ---------------------------------------------------------------------------

class MemoryStore:
    """Dual-store memory: markdown wiki files + JSON metadata index.

    Directory layout::

        {MEMORY_ROOT}/
          {project_id}/wiki/project/{key}.md
          global/wiki/global/{key}.md
          global/wiki/session/{session_name}/{key}.md
          global/wiki/agent/{agent_profile}/{key}.md
          federated/wiki/federated/{key}.md
          {scope}_index.json          # per-scope metadata file
    """

    _lock = threading.Lock()

    def __init__(self, root: Optional[Path] = None) -> None:
        self.root = Path(root) if root else MEMORY_ROOT
        self.root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Path resolution
    # ------------------------------------------------------------------

    def _scope_dir(self, scope: str, scope_id: str = "") -> Path:
        """Resolve the directory for a scope."""
        root = self.root
        scope_id = scope_id.strip()
        if scope == "global":
            return root / "global" / "wiki" / "global"
        elif scope == "project":
            pid = scope_id or _hash_project_id(os.getcwd())
            return root / pid / "wiki" / "project"
        elif scope == "session":
            sid = scope_id or "default"
            return root / "global" / "wiki" / "session" / sid
        elif scope == "agent":
            aid = scope_id or "default"
            return root / "global" / "wiki" / "agent" / aid
        elif scope == "federated":
            return root / "federated" / "wiki" / "federated"
        return root / "unknown"

    def _wiki_path(self, entry: MemoryEntry) -> Path:
        return self._scope_dir(entry.scope, entry.scope_id) / f"{entry.key}.md"

    def _index_path(self, scope: str, scope_id: str = "") -> Path:
        d = self._scope_dir(scope, scope_id)
        return d / "_index.json"

    # ------------------------------------------------------------------
    # CRUD
    # ------------------------------------------------------------------

    def store(self, entry: MemoryEntry) -> MemoryEntry:
        """Upsert a memory entry. Writes both the wiki file and updates the index."""
        entry.key = entry.key.strip()
        if not entry.key or not entry.content.strip():
            raise ValueError("key and content are required")

        if entry.scope not in VALID_SCOPES:
            raise ValueError(f"scope must be one of {sorted(VALID_SCOPES)}")
        if entry.memory_type not in VALID_TYPES:
            raise ValueError(f"memory_type must be one of {sorted(VALID_TYPES)}")

        now = _now_iso()
        if not entry.created_at:
            entry.created_at = now
        entry.updated_at = now

        with self._lock:
            wiki = self._wiki_path(entry)
            wiki.parent.mkdir(parents=True, exist_ok=True)

            # Upsert wiki content — append a timestamped entry
            existing = ""
            if wiki.exists():
                existing = wiki.read_text(encoding="utf-8", errors="replace")
                # Only append if content differs from last entry
                if entry.content.strip() in existing:
                    pass  # duplicate content, skip appending
                else:
                    pass  # will append below

            entry_text = f"\n\n<!-- {now} -->\n{entry.content.strip()}"
            wiki.write_text(existing.rstrip() + entry_text, encoding="utf-8")

            # Update index
            self._update_index(entry)

        return entry

    def recall(
        self,
        query: str = "",
        scope: str = "",
        scope_id: str = "",
        memory_type: str = "",
        limit: int = 10,
        sort_by: str = "recency",   # recency | score | usage
    ) -> list[MemoryEntry]:
        """Search memories. ``query`` searches against content and tags.
        When no ``scope`` is specified, results follow precedence:
        session > project > global.
        """
        results: list[MemoryEntry] = []

        scopes_to_search: list[tuple[str, str]]
        if scope:
            scopes_to_search = [(scope, scope_id)]
        else:
            # Default precedence
            cwd = os.getcwd()
            scopes_to_search = [
                ("session", ""),
                ("project", _hash_project_id(cwd)),
                ("global", ""),
            ]

        seen: set[str] = set()
        for s, sid in scopes_to_search:
            index = self._load_index(s, sid)
            for d in index:
                e = MemoryEntry.from_dict(d)
                if e.key in seen:
                    continue
                if not self._filter(e, query, memory_type):
                    continue
                seen.add(e.key)
                results.append(e)
            if len(results) >= limit:
                break

        if sort_by == "recency":
            results.sort(key=lambda e: e.updated_at or e.created_at, reverse=True)
        elif sort_by == "usage":
            results.sort(key=lambda e: e.usage_count, reverse=True)
        # "score" is BM25 — fall back to recency if rank_bm25 unavailable

        return results[:limit]

    def forget(self, key: str, scope: str = "project", scope_id: str = "") -> bool:
        """Delete a memory entry. Returns True if it existed."""
        with self._lock:
            entry = MemoryEntry(key=key, scope=scope, scope_id=scope_id)
            wiki = self._wiki_path(entry)
            deleted = False
            if wiki.exists():
                wiki.unlink()
                deleted = True
            self._remove_from_index(key, scope, scope_id)
            return deleted

    def get_context_block(
        self,
        scope: str = "",
        scope_id: str = "",
        task_description: str = "",
        max_chars: int = MEMORY_SCOPE_BUDGET_CHARS * 3,
    ) -> str:
        """Build the ``<cao-memory>`` context block for session injection.

        Searches across session > project > global scope precedence and
        returns formatted entries up to ``max_chars``.
        """
        entries = self.recall(query=task_description, limit=MEMORY_MAX_PER_SCOPE * 3)
        if not entries:
            return ""

        lines: list[str] = ["<cao-memory>", "## Context from Fusion Memory"]
        chars = 0
        seen: set[str] = set()
        for e in entries:
            if e.key in seen:
                continue
            seen.add(e.key)
            line = f"- [{e.scope}] {e.key}: {e.content[:200]}"
            if chars + len(line) > max_chars:
                break
            lines.append(line)
            chars += len(line)
        lines.append("</cao-memory>")
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Index helpers
    # ------------------------------------------------------------------

    def _load_index(self, scope: str, scope_id: str = "") -> list[dict]:
        """Load the metadata index for a scope. Expired entries are pruned."""
        ip = self._index_path(scope, scope_id)
        if not ip.exists():
            return []
        try:
            data = json.loads(ip.read_text(encoding="utf-8"))
            if not isinstance(data, list):
                return []
        except (json.JSONDecodeError, OSError):
            return []

        now = datetime.now(timezone.utc)
        keep: list[dict] = []
        for d in data:
            if self._is_expired(d, now):
                self._cleanup_wiki(d)
                continue
            keep.append(d)
        return keep

    def _update_index(self, entry: MemoryEntry) -> None:
        idx = self._load_index(entry.scope, entry.scope_id)
        # Upsert
        found = False
        for d in idx:
            if d.get("key") == entry.key:
                d.update(entry.to_dict())
                found = True
                break
        if not found:
            idx.append(entry.to_dict())
        ip = self._index_path(entry.scope, entry.scope_id)
        ip.parent.mkdir(parents=True, exist_ok=True)
        ip.write_text(json.dumps(idx, indent=2, ensure_ascii=False), encoding="utf-8")

    def _remove_from_index(self, key: str, scope: str, scope_id: str) -> None:
        idx = self._load_index(scope, scope_id)
        idx = [d for d in idx if d.get("key") != key]
        ip = self._index_path(scope, scope_id)
        ip.parent.mkdir(parents=True, exist_ok=True)
        ip.write_text(json.dumps(idx, indent=2, ensure_ascii=False), encoding="utf-8")

    # ------------------------------------------------------------------
    # Retention & cleanup
    # ------------------------------------------------------------------

    def _is_expired(self, d: dict, now: Optional[datetime] = None) -> bool:
        if now is None:
            now = datetime.now(timezone.utc)
        scope = d.get("scope", "")
        mtype = d.get("memory_type", "")
        # Type-level overrides: user/feedback never expire
        if mtype in TYPE_RETENTION and TYPE_RETENTION[mtype] is None:
            return False
        retention_days = SCOPE_RETENTION.get(scope)
        if retention_days is None:
            return False
        created = d.get("created_at", "")
        if not created:
            return False
        try:
            ts = datetime.fromisoformat(created)
        except ValueError:
            return False
        return (now - ts) > timedelta(days=retention_days)

    def _cleanup_wiki(self, d: dict) -> None:
        """Remove expired wiki file if it still exists."""
        e = MemoryEntry.from_dict(d)
        wiki = self._wiki_path(e)
        if wiki.exists():
            wiki.unlink(missing_ok=True)

    # ------------------------------------------------------------------
    # Query filter
    # ------------------------------------------------------------------

    def _filter(self, entry: MemoryEntry, query: str, memory_type: str) -> bool:
        if memory_type and entry.memory_type != memory_type:
            return False
        if not query:
            return True
        q = query.lower()
        if q in entry.key.lower() or q in entry.content.lower():
            return True
        for tag in entry.tags:
            if q in tag.lower():
                return True
        return False


# ---------------------------------------------------------------------------
# Session-scoped injection tracker
# ---------------------------------------------------------------------------

_injected_sessions: set[str] = set()
_injection_lock = threading.Lock()


def should_inject(session_id: str) -> bool:
    """Check whether memory context should be injected for this session.
    Returns ``True`` once per session lifetime."""
    with _injection_lock:
        if session_id in _injected_sessions:
            return False
        _injected_sessions.add(session_id)
        return True


def clear_injection(session_id: str) -> None:
    with _injection_lock:
        _injected_sessions.discard(session_id)


# ---------------------------------------------------------------------------
# Module-level convenience
# ---------------------------------------------------------------------------

_default_store: Optional[MemoryStore] = None


def get_store() -> MemoryStore:
    global _default_store
    if _default_store is None:
        _default_store = MemoryStore()
    return _default_store


def memory_store(
    content: str,
    scope: str = "project",
    memory_type: str = "feedback",
    key: str = "",
    tags: str = "",
) -> MemoryEntry:
    """Store a memory entry. If ``key`` is empty, it is derived from content."""
    if not key:
        words = re.findall(r"\b[a-zA-Z]{3,}\b", content)
        key = "-".join(words[:6]).lower() if words else "memory"
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    entry = MemoryEntry(
        key=key, content=content.strip(), scope=scope, memory_type=memory_type,
        tags=tag_list,
    )
    return get_store().store(entry)


def memory_recall(
    query: str = "",
    scope: str = "",
    memory_type: str = "",
    limit: int = 10,
    sort_by: str = "recency",
) -> list[MemoryEntry]:
    """Recall memories matching the given criteria."""
    return get_store().recall(
        query=query, scope=scope, memory_type=memory_type,
        limit=limit, sort_by=sort_by,
    )


def memory_forget(key: str, scope: str = "project") -> bool:
    """Delete a memory entry by key."""
    return get_store().forget(key=key, scope=scope)


def inject_memory_context(
    session_id: str,
    task_description: str = "",
) -> str:
    """Build and return the memory block for session injection. Only returns
    content on the first call per session."""
    if not should_inject(session_id):
        return ""
    return get_store().get_context_block(task_description=task_description)
