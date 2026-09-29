"""Agent communications bus — JSONL store, no daemon.

Best-of hcom (named agents, inbox, poll/send/ack, collision notes), agmsg
(WAL-like JSONL, rooms, history replay), A2A (agent cards + task fields),
and the hive board (rooms hive/architect/captains/workers/system, DMs as
``dm:a:b``). Stdlib only.

Runtime store (override with ``ANDREWCODE_COMMS_DIR``)::

    {workspace}/.andrewcode/comms/
      board.jsonl          append-only messages
      agents.json          agent cards
      mailbox/<id>.jsonl   per-agent inbox
      context.json         agency context snapshot
      events.jsonl         collision / presence / system events

When ``FUSION_BOARD`` is set, posts/polls also reuse ``fusion_swarm.board``
HiveBoard APIs against that sqlite file — they are not forked.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

MESSAGE_KINDS = ("message", "system", "ack", "presence", "handoff", "task")
AGENT_ROLES = ("architect", "operator", "captain", "worker", "child", "human")
AGENT_STATUSES = ("online", "offline", "busy", "idle", "error")
DEFAULT_CHANNELS = ("hive", "architect", "captains", "workers", "system")
CONTEXT_ACTIONS = ("list", "get", "set", "clear", "snapshot")
HIVE_MESSAGE_KINDS = ("message", "system", "ack", "presence")

# Role -> default rooms an agent is auto-routed to (hcom + hive board).
_ROLE_ROOMS = {
    "architect": ("hive", "architect", "system"),
    "operator": ("hive", "architect", "captains", "system"),
    "captain": ("hive", "captains"),
    "worker": ("hive", "workers"),
    "child": ("hive", "workers"),
    "human": ("hive", "system"),
}

_HIVE_ROLES = ("architect", "operator", "captain", "worker", "child")


class CommsError(ValueError):
    """Raised when a comms operation is rejected. Fail-closed."""


# --- time / ids ---------------------------------------------------------------

def _now() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")
    return stamp[:-3] + "Z"


def _new_id() -> str:
    return uuid.uuid4().hex


def _require_str(value: Any, name: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise CommsError(f"{name} must be a string")
    if not allow_empty and not value.strip():
        raise CommsError(f"{name} must be a non-empty string")
    return value


def _json_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        parts = [p.strip() for p in value.split(",") if p.strip()]
        return parts
    if isinstance(value, (list, tuple)):
        out: list[str] = []
        for item in value:
            if not isinstance(item, str) or not item.strip():
                raise CommsError("mentions must be a list of non-empty strings")
            out.append(item.strip())
        return out
    raise CommsError("mentions must be a list of strings or a comma-separated string")


def _dm_channel(a: str, b: str) -> str:
    x, y = sorted((a, b))
    return f"dm:{x}:{y}"


def _safe_agent_id(agent_id: str) -> str:
    agent_id = _require_str(agent_id, "id")
    if agent_id in (".", "..") or "/" in agent_id or "\\" in agent_id:
        raise CommsError(f"invalid agent id: {agent_id!r}")
    return agent_id


def _mentions_from_body(body: str) -> list[str]:
    found: list[str] = []
    for token in body.split():
        if token.startswith("@") and len(token) > 1:
            name = token[1:].rstrip(".,;:!?")
            if name and name not in found:
                found.append(name)
    return found


def _merge_mentions(explicit: Any, body: str) -> list[str]:
    out: list[str] = []
    for item in _json_list(explicit) + _mentions_from_body(body):
        if item not in out:
            out.append(item)
    return out


def _parse_value(raw: str) -> Any:
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return raw


# --- paths --------------------------------------------------------------------

def resolve_comms_dir(cwd: Optional[str] = None) -> Path:
    """Return the comms store directory.

    ``ANDREWCODE_COMMS_DIR`` wins; otherwise ``{cwd}/.andrewcode/comms``.
    """
    override = os.environ.get("ANDREWCODE_COMMS_DIR")
    if override and override.strip():
        return Path(override).expanduser().resolve()
    root = Path(cwd or os.getcwd()).expanduser().resolve()
    return root / ".andrewcode" / "comms"


def _paths(cwd: Optional[str] = None) -> dict[str, Path]:
    root = resolve_comms_dir(cwd)
    return {
        "root": root,
        "board": root / "board.jsonl",
        "agents": root / "agents.json",
        "mailbox": root / "mailbox",
        "context": root / "context.json",
        "events": root / "events.jsonl",
        "lock": root / ".lock",
    }


def _empty_context() -> dict[str, Any]:
    return {
        "data": {},
        "session_id": "",
        "current_agent_name": "",
        "shared_instructions": "",
        "updated_at": _now(),
    }


def init_comms(cwd: Optional[str] = None) -> Path:
    """Create the comms directory tree if missing. Returns the store path."""
    paths = _paths(cwd)
    root = paths["root"]
    root.mkdir(parents=True, exist_ok=True)
    paths["mailbox"].mkdir(parents=True, exist_ok=True)
    if not paths["board"].exists():
        paths["board"].write_text("", encoding="utf-8")
    if not paths["events"].exists():
        paths["events"].write_text("", encoding="utf-8")
    if not paths["agents"].exists():
        _write_json_atomic(paths["agents"], {"agents": []})
    if not paths["context"].exists():
        _write_json_atomic(paths["context"], _empty_context())
    _maybe_init_hive_board()
    return root


# --- exclusive write (mkdir lock + tmp-rename) --------------------------------

class _DirLock:
    """Process-exclusive lock via atomic mkdir. No daemon."""

    def __init__(self, lock_dir: Path, timeout: float = 8.0, stale_after: float = 60.0):
        self.lock_dir = lock_dir
        self.timeout = timeout
        self.stale_after = stale_after

    def __enter__(self) -> "_DirLock":
        deadline = time.time() + self.timeout
        while True:
            try:
                os.mkdir(self.lock_dir)
                (self.lock_dir / "pid").write_text(str(os.getpid()), encoding="utf-8")
                return self
            except FileExistsError:
                if self._stale():
                    shutil.rmtree(self.lock_dir, ignore_errors=True)
                    continue
                if time.time() >= deadline:
                    raise CommsError("comms directory is locked")
                time.sleep(0.03)

    def __exit__(self, *exc: Any) -> None:
        shutil.rmtree(self.lock_dir, ignore_errors=True)

    def _stale(self) -> bool:
        try:
            age = time.time() - self.lock_dir.stat().st_mtime
        except OSError:
            return True
        return age > self.stale_after


def _locked(cwd: Optional[str] = None) -> _DirLock:
    paths = _paths(cwd)
    paths["root"].mkdir(parents=True, exist_ok=True)
    return _DirLock(paths["lock"])


def _write_json_atomic(path: Path, obj: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    payload = json.dumps(obj, ensure_ascii=False, indent=2) + "\n"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(payload)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def _append_jsonl(path: Path, rec: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
        fh.flush()
        os.fsync(fh.fileno())


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(rec, dict):
                out.append(rec)
    return out


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return default
    return data


# --- agent cards --------------------------------------------------------------

def _normalize_card(raw: dict[str, Any]) -> dict[str, Any]:
    agent_id = _safe_agent_id(str(raw.get("id", "")))
    role = raw.get("role") or "worker"
    if role not in AGENT_ROLES:
        raise CommsError(f"role must be one of {AGENT_ROLES}")
    status = raw.get("status") or "idle"
    if status not in AGENT_STATUSES:
        raise CommsError(f"status must be one of {AGENT_STATUSES}")
    caps = raw.get("capabilities") or []
    if isinstance(caps, str):
        caps = [p.strip() for p in caps.split(",") if p.strip()]
    if not isinstance(caps, list) or any(not isinstance(c, str) for c in caps):
        raise CommsError("capabilities must be a list of strings")
    provider = raw.get("provider")
    model = raw.get("model")
    if provider is not None:
        provider = _require_str(provider, "provider", allow_empty=True) or None
    if model is not None:
        model = _require_str(model, "model", allow_empty=True) or None
    card = {
        "id": agent_id,
        "role": role,
        "capabilities": list(caps),
        "status": status,
    }
    if provider:
        card["provider"] = provider
    if model:
        card["model"] = model
    return card


def _load_agents_unlocked(cwd: Optional[str] = None) -> list[dict[str, Any]]:
    raw = _read_json(_paths(cwd)["agents"], {"agents": []})
    if isinstance(raw, list):
        return [a for a in raw if isinstance(a, dict)]
    if isinstance(raw, dict) and isinstance(raw.get("agents"), list):
        return [a for a in raw["agents"] if isinstance(a, dict)]
    return []


def _save_agents_unlocked(agents: list[dict[str, Any]], cwd: Optional[str] = None) -> None:
    _write_json_atomic(_paths(cwd)["agents"], {"agents": agents})


def list_agents(cwd: Optional[str] = None) -> list[dict[str, Any]]:
    init_comms(cwd)
    with _locked(cwd):
        return _load_agents_unlocked(cwd)


def upsert_agent_card(card: dict[str, Any], cwd: Optional[str] = None) -> dict[str, Any]:
    init_comms(cwd)
    normalized = _normalize_card(card)
    with _locked(cwd):
        agents = _load_agents_unlocked(cwd)
        replaced = False
        for i, existing in enumerate(agents):
            if existing.get("id") == normalized["id"]:
                merged = dict(existing)
                merged.update(normalized)
                agents[i] = _normalize_card(merged)
                normalized = agents[i]
                replaced = True
                break
        if not replaced:
            agents.append(normalized)
        _save_agents_unlocked(agents, cwd)
    _maybe_register_hive(normalized)
    return normalized


def _agent_by_id(agent_id: str, cwd: Optional[str] = None) -> Optional[dict[str, Any]]:
    for card in _load_agents_unlocked(cwd):
        if card.get("id") == agent_id:
            return card
    return None


def _mailbox_path(agent_id: str, cwd: Optional[str] = None) -> Path:
    return _paths(cwd)["mailbox"] / f"{_safe_agent_id(agent_id)}.jsonl"


def _acks_path(agent_id: str, cwd: Optional[str] = None) -> Path:
    return _paths(cwd)["mailbox"] / f"{_safe_agent_id(agent_id)}.acks.json"


def _load_acks_unlocked(agent_id: str, cwd: Optional[str] = None) -> set[str]:
    raw = _read_json(_acks_path(agent_id, cwd), {"ids": []})
    ids = raw.get("ids") if isinstance(raw, dict) else raw
    if not isinstance(ids, list):
        return set()
    return {str(x) for x in ids}


def _save_acks_unlocked(agent_id: str, ids: set[str], cwd: Optional[str] = None) -> None:
    ordered = sorted(ids)
    _write_json_atomic(_acks_path(agent_id, cwd), {"ids": ordered})


# --- messages -----------------------------------------------------------------

def _envelope(
    *,
    from_agent: str,
    body: str,
    channel: str,
    kind: str,
    to: Optional[str],
    mentions: list[str],
    thread_id: Optional[str],
    task_id: Optional[str],
    msg_id: Optional[str] = None,
    ts: Optional[str] = None,
) -> dict[str, Any]:
    return {
        "id": msg_id or _new_id(),
        "ts": ts or _now(),
        "from": from_agent,
        "to": to,
        "channel": channel,
        "kind": kind,
        "body": body,
        "mentions": mentions,
        "threadId": thread_id,
        "taskId": task_id,
    }


def _route_recipients(msg: dict[str, Any], cwd: Optional[str] = None) -> list[str]:
    """Who gets a mailbox copy (hcom inbox). Sender is excluded."""
    sender = msg.get("from")
    recipients: list[str] = []

    def add(agent_id: Optional[str]) -> None:
        if not agent_id or agent_id == sender or agent_id in recipients:
            return
        recipients.append(agent_id)

    add(msg.get("to"))
    for mention in msg.get("mentions") or []:
        add(mention)

    channel = msg.get("channel") or "hive"
    if isinstance(channel, str) and channel.startswith("dm:"):
        parts = channel.split(":")
        if len(parts) == 3:
            add(parts[1])
            add(parts[2])

    agents = _load_agents_unlocked(cwd)
    for card in agents:
        rooms = _ROLE_ROOMS.get(card.get("role") or "worker", ("hive",))
        if channel in rooms:
            add(card.get("id"))
    return recipients


def post_message(
    *,
    from_agent: str,
    body: str,
    channel: str = "hive",
    to: Optional[str] = None,
    kind: str = "message",
    mentions: Any = None,
    thread_id: Optional[str] = None,
    task_id: Optional[str] = None,
    cwd: Optional[str] = None,
) -> dict[str, Any]:
    init_comms(cwd)
    from_agent = _safe_agent_id(from_agent)
    body = _require_str(body, "body")
    channel = _require_str(channel, "channel")
    if kind not in MESSAGE_KINDS:
        raise CommsError(f"kind must be one of {MESSAGE_KINDS}")
    if to is not None:
        to = _safe_agent_id(to)
    if thread_id is not None:
        thread_id = _require_str(str(thread_id), "threadId")
    if task_id is not None:
        task_id = _require_str(str(task_id), "taskId")
    mention_list = _merge_mentions(mentions, body)

    if _agent_by_id(from_agent, cwd) is None:
        upsert_agent_card({"id": from_agent, "role": "worker", "status": "online"}, cwd=cwd)

    msg = _envelope(
        from_agent=from_agent,
        body=body,
        channel=channel,
        kind=kind,
        to=to,
        mentions=mention_list,
        thread_id=thread_id,
        task_id=task_id,
    )

    with _locked(cwd):
        paths = _paths(cwd)
        _append_jsonl(paths["board"], msg)
        for agent_id in _route_recipients(msg, cwd):
            _append_jsonl(_mailbox_path(agent_id, cwd), msg)

    hive_rec = _maybe_hive_post(msg)
    if hive_rec is not None:
        msg = dict(msg)
        msg["hiveId"] = hive_rec.get("id")
    return msg


def poll_inbox(
    agent_id: str,
    *,
    since: Optional[str] = None,
    limit: int = 100,
    cwd: Optional[str] = None,
) -> list[dict[str, Any]]:
    init_comms(cwd)
    agent_id = _safe_agent_id(agent_id)
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
        raise CommsError("limit must be a positive integer")

    with _locked(cwd):
        acked = _load_acks_unlocked(agent_id, cwd)
        rows = _read_jsonl(_mailbox_path(agent_id, cwd))

    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    if since is not None and not any(str(r.get("id", "")) == since for r in rows):
        # Unknown cursor: replay from the start rather than returning empty.
        since = None
    skipping = since is not None
    for rec in rows:
        rec_id = str(rec.get("id", ""))
        if skipping:
            if rec_id == since:
                skipping = False
            continue
        if rec_id in acked or rec_id in seen_ids:
            continue
        seen_ids.add(rec_id)
        out.append(rec)
        if len(out) >= limit:
            break

    if len(out) < limit:
        fingerprints = {
            (r.get("from"), r.get("channel"), r.get("body"))
            for r in _read_jsonl(_paths(cwd)["board"])
        }
        for rec in _maybe_hive_poll(agent_id, since=since, limit=limit):
            rec_id = str(rec.get("id", ""))
            fp = (rec.get("from"), rec.get("channel"), rec.get("body"))
            if rec_id in acked or rec_id in seen_ids or fp in fingerprints:
                continue
            seen_ids.add(rec_id)
            out.append(rec)
            if len(out) >= limit:
                break
    return out


def ack(agent_id: str, message_id: str, cwd: Optional[str] = None) -> dict[str, Any]:
    init_comms(cwd)
    agent_id = _safe_agent_id(agent_id)
    message_id = _require_str(str(message_id), "message_id")
    stamp = _now()
    with _locked(cwd):
        ids = _load_acks_unlocked(agent_id, cwd)
        ids.add(message_id)
        _save_acks_unlocked(agent_id, ids, cwd)
        event = {
            "id": _new_id(),
            "ts": stamp,
            "kind": "ack",
            "from": agent_id,
            "to": None,
            "channel": "system",
            "body": message_id,
            "mentions": [],
            "threadId": None,
            "taskId": None,
            "messageId": message_id,
        }
        _append_jsonl(_paths(cwd)["events"], event)

    _maybe_hive_ack(agent_id, message_id)
    return {"ok": True, "agent_id": agent_id, "message_id": message_id, "acked_at": stamp}


def list_channel(
    channel: str,
    *,
    limit: int = 200,
    cwd: Optional[str] = None,
) -> list[dict[str, Any]]:
    init_comms(cwd)
    channel = _require_str(channel, "channel")
    rows = [r for r in _read_jsonl(_paths(cwd)["board"]) if r.get("channel") == channel]
    if limit > 0:
        rows = rows[-limit:]
    return rows


def history(
    *,
    channel: Optional[str] = None,
    limit: int = 200,
    cwd: Optional[str] = None,
) -> list[dict[str, Any]]:
    init_comms(cwd)
    rows = _read_jsonl(_paths(cwd)["board"])
    if channel:
        channel = _require_str(channel, "channel")
        rows = [r for r in rows if r.get("channel") == channel]
    if limit > 0:
        rows = rows[-limit:]
    return rows


def list_channels(cwd: Optional[str] = None) -> list[dict[str, Any]]:
    init_comms(cwd)
    seen: dict[str, int] = {name: 0 for name in DEFAULT_CHANNELS}
    for rec in _read_jsonl(_paths(cwd)["board"]):
        name = rec.get("channel")
        if isinstance(name, str) and name.strip():
            seen[name] = seen.get(name, 0) + 1
    hive_names = _maybe_hive_channels()
    for name in hive_names:
        seen.setdefault(name, 0)
    out = []
    for name in sorted(seen):
        kind = "dm" if name.startswith("dm:") else "room"
        if name.startswith("task:"):
            kind = "task"
        out.append({"name": name, "kind": kind, "count": seen[name]})
    return out


def append_event(
    kind: str,
    payload: Optional[dict[str, Any]] = None,
    cwd: Optional[str] = None,
) -> dict[str, Any]:
    init_comms(cwd)
    kind = _require_str(kind, "kind")
    rec = {
        "id": _new_id(),
        "ts": _now(),
        "kind": kind,
        **(payload or {}),
    }
    with _locked(cwd):
        _append_jsonl(_paths(cwd)["events"], rec)
    return rec


def record_collision(
    path: str,
    agents: Iterable[str],
    cwd: Optional[str] = None,
) -> dict[str, Any]:
    """hcom-style same-file edit note. No daemon, JSONL only."""
    path = _require_str(path, "path")
    names = [ _require_str(a, "agent") for a in agents ]
    if len(names) < 2:
        raise CommsError("collision requires at least two agents")
    return append_event(
        "collision",
        {
            "path": path,
            "agents": names,
            "note": "same-file edit collision (hcom-style, no daemon)",
        },
        cwd=cwd,
    )


# --- agency context (persisted to comms/context.json) -------------------------

def load_context(cwd: Optional[str] = None) -> dict[str, Any]:
    init_comms(cwd)
    raw = _read_json(_paths(cwd)["context"], _empty_context())
    if not isinstance(raw, dict):
        return _empty_context()
    data = raw.get("data")
    if not isinstance(data, dict):
        data = {}
    return {
        "data": dict(data),
        "session_id": raw.get("session_id") or "",
        "current_agent_name": raw.get("current_agent_name") or "",
        "shared_instructions": raw.get("shared_instructions") or "",
        "updated_at": raw.get("updated_at") or _now(),
    }


def replace_context(payload: dict[str, Any], cwd: Optional[str] = None) -> dict[str, Any]:
    init_comms(cwd)
    data = payload.get("data") if isinstance(payload.get("data"), dict) else dict(payload)
    rec = {
        "data": dict(data),
        "session_id": payload.get("session_id") or "",
        "current_agent_name": payload.get("current_agent_name") or "",
        "shared_instructions": payload.get("shared_instructions") or "",
        "updated_at": _now(),
    }
    with _locked(cwd):
        _write_json_atomic(_paths(cwd)["context"], rec)
    return rec


def context_list(cwd: Optional[str] = None) -> dict[str, Any]:
    rec = load_context(cwd)
    keys = sorted(str(k) for k in rec["data"].keys())
    return {"ok": True, "keys": keys, "count": len(keys)}


def context_get(key: str, cwd: Optional[str] = None) -> dict[str, Any]:
    key = _require_str(key, "key")
    rec = load_context(cwd)
    found = key in rec["data"]
    return {"ok": True, "key": key, "value": rec["data"].get(key), "found": found}


def context_set(key: str, value: Any, cwd: Optional[str] = None) -> dict[str, Any]:
    key = _require_str(key, "key")
    rec = load_context(cwd)
    rec["data"][key] = value
    saved = replace_context(rec, cwd=cwd)
    return {"ok": True, "key": key, "value": saved["data"].get(key)}


def context_clear(cwd: Optional[str] = None) -> dict[str, Any]:
    rec = load_context(cwd)
    rec["data"] = {}
    replace_context(rec, cwd=cwd)
    return {"ok": True, "cleared": True}


def snapshot_context(cwd: Optional[str] = None) -> dict[str, Any]:
    rec = load_context(cwd)
    rec["updated_at"] = _now()
    saved = replace_context(rec, cwd=cwd)
    saved["ok"] = True
    return saved


def summarize_comms(cwd: Optional[str] = None) -> str:
    init_comms(cwd)
    agents = list_agents(cwd)
    messages = _read_jsonl(_paths(cwd)["board"])
    channels = list_channels(cwd)
    return (
        f"comms {resolve_comms_dir(cwd)} — "
        f"{len(agents)} agents, {len(messages)} messages, "
        f"{len(channels)} channels"
    )


# --- hive board bridge (reuse board.py, do not fork) --------------------------

def _hive_board_path() -> Optional[str]:
    raw = os.environ.get("FUSION_BOARD")
    if raw and raw.strip():
        return raw.strip()
    return None


def _open_hive_board():
    path = _hive_board_path()
    if not path:
        return None
    try:
        from .board import HiveBoard
        return HiveBoard(path)
    except Exception:
        return None


def _maybe_init_hive_board() -> None:
    board = _open_hive_board()
    if board is None:
        return
    try:
        board.init_schema()
    except Exception:
        pass
    finally:
        board.close()


def _maybe_register_hive(card: dict[str, Any]) -> None:
    board = _open_hive_board()
    if board is None:
        return
    role = card.get("role") or "worker"
    if role not in _HIVE_ROLES:
        role = "operator" if role == "human" else "worker"
    try:
        board.register({
            "id": card["id"],
            "display_name": card["id"],
            "role": role,
            "provider": card.get("provider") or "unknown",
            "model": card.get("model") or "unknown",
            "status": card.get("status") or "online",
        })
    except Exception:
        pass
    finally:
        board.close()


def _maybe_hive_post(msg: dict[str, Any]) -> Optional[dict[str, Any]]:
    board = _open_hive_board()
    if board is None:
        return None
    try:
        from .board import BoardError
        kind = msg.get("kind") if msg.get("kind") in HIVE_MESSAGE_KINDS else "message"
        channel = msg.get("channel") or "hive"
        try:
            board.ensure_channel(channel, kind=_channel_kind(channel), created_by=msg["from"])
        except BoardError:
            pass
        if _agent_missing_on_hive(board, msg["from"]):
            _register_bare(board, msg["from"])
        to_agent = msg.get("to")
        if to_agent and _agent_missing_on_hive(board, to_agent):
            _register_bare(board, to_agent)
        rec = board.post(
            from_agent=msg["from"],
            body=msg["body"],
            channel=channel,
            mentions=msg.get("mentions") or [],
            to_agent=to_agent,
            kind=kind,
        )
        return rec
    except Exception:
        return None
    finally:
        board.close()


def _agent_missing_on_hive(board: Any, agent_id: str) -> bool:
    try:
        return all(a.get("id") != agent_id for a in board.agents())
    except Exception:
        return True


def _register_bare(board: Any, agent_id: str) -> None:
    try:
        board.register({
            "id": agent_id,
            "display_name": agent_id,
            "role": "worker",
            "provider": "unknown",
            "model": "unknown",
            "status": "online",
        })
    except Exception:
        pass


def _channel_kind(name: str) -> str:
    if name.startswith("dm:"):
        return "dm"
    if name.startswith("task:"):
        return "task"
    return "room"


def _hive_to_envelope(row: dict[str, Any]) -> dict[str, Any]:
    thread = row.get("thread_id")
    return {
        "id": f"hive:{row.get('id')}",
        "ts": row.get("created_at") or _now(),
        "from": row.get("from_agent"),
        "to": row.get("to_agent"),
        "channel": row.get("channel") or "hive",
        "kind": row.get("kind") or "message",
        "body": row.get("body") or "",
        "mentions": list(row.get("mentions") or []),
        "threadId": None if thread is None else str(thread),
        "taskId": None,
        "hiveId": row.get("id"),
    }


def _maybe_hive_poll(
    agent_id: str,
    *,
    since: Optional[str] = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    board = _open_hive_board()
    if board is None:
        return []
    try:
        since_id = None
        if since and str(since).startswith("hive:"):
            try:
                since_id = int(str(since).split(":", 1)[1])
            except ValueError:
                since_id = None
        rows = board.poll(agent_id, since_id=since_id, limit=limit)
        return [_hive_to_envelope(r) for r in rows]
    except Exception:
        return []
    finally:
        board.close()


def _maybe_hive_ack(agent_id: str, message_id: str) -> None:
    if not str(message_id).startswith("hive:"):
        return
    board = _open_hive_board()
    if board is None:
        return
    try:
        hid = int(str(message_id).split(":", 1)[1])
        board.ack(agent_id, hid)
    except Exception:
        pass
    finally:
        board.close()


def _maybe_hive_channels() -> list[str]:
    board = _open_hive_board()
    if board is None:
        return []
    try:
        return [c.get("name") for c in board.channels() if c.get("name")]
    except Exception:
        return []
    finally:
        board.close()


# --- CLI ----------------------------------------------------------------------

def _print_json(obj: Any) -> None:
    print(json.dumps(obj, ensure_ascii=False, default=str))


def _add_dir_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--dir",
        dest="comms_dir",
        default=None,
        help="override ANDREWCODE_COMMS_DIR",
    )
    parser.add_argument(
        "--cwd",
        dest="cwd",
        default=None,
        help="workspace whose .andrewcode/comms to use",
    )


def _bind_store(args: argparse.Namespace) -> Optional[str]:
    comms_dir = getattr(args, "comms_dir", None)
    if comms_dir:
        os.environ["ANDREWCODE_COMMS_DIR"] = comms_dir
    return getattr(args, "cwd", None)


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="fusion_swarm.comms",
        description="AndrewCode agent comms bus — always prints JSON.",
    )
    _add_dir_args(ap)
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="create .andrewcode/comms store")

    p_post = sub.add_parser("post", help="append a message")
    p_post.add_argument("--from", dest="from_agent", required=True)
    p_post.add_argument("--body", required=True)
    p_post.add_argument("--channel", default="hive")
    p_post.add_argument("--to", dest="to_agent", default=None)
    p_post.add_argument("--kind", default="message")
    p_post.add_argument("--mentions", default="")
    p_post.add_argument("--thread-id", dest="thread_id", default=None)
    p_post.add_argument("--task-id", dest="task_id", default=None)

    p_poll = sub.add_parser("poll", help="poll an agent inbox")
    p_poll.add_argument("--agent", required=True)
    p_poll.add_argument("--since", dest="since", default=None)
    p_poll.add_argument("--limit", type=int, default=100)

    p_ack = sub.add_parser("ack", help="acknowledge a message")
    p_ack.add_argument("--agent", required=True)
    p_ack.add_argument("--id", dest="message_id", required=True)

    p_reg = sub.add_parser("register", help="upsert an agent card")
    p_reg.add_argument("--id", required=True)
    p_reg.add_argument("--role", default="worker")
    p_reg.add_argument("--provider", default=None)
    p_reg.add_argument("--model", default=None)
    p_reg.add_argument("--capabilities", default="")
    p_reg.add_argument("--status", default="idle")

    sub.add_parser("agents", help="list agent cards")
    sub.add_parser("channels", help="list channels")

    p_hist = sub.add_parser("history", help="replay board.jsonl")
    p_hist.add_argument("--channel", default=None)
    p_hist.add_argument("--limit", type=int, default=200)

    p_ctx = sub.add_parser("context", help="agency context get/set/list/clear/snapshot")
    # Flags after `context` so `context.sh --cwd DIR list` works. SUPPRESS
    # keeps a parent-level --cwd/--dir from being overwritten with None.
    p_ctx.add_argument("--dir", dest="comms_dir", default=argparse.SUPPRESS)
    p_ctx.add_argument("--cwd", dest="cwd", default=argparse.SUPPRESS)
    p_ctx.add_argument(
        "action",
        nargs="?",
        default="list",
        choices=CONTEXT_ACTIONS,
    )
    p_ctx.add_argument("key", nargs="?", default=None)
    p_ctx.add_argument("value", nargs="?", default=None)

    p_col = sub.add_parser("collision", help="record a same-file edit collision")
    p_col.add_argument("--path", required=True)
    p_col.add_argument("--agents", required=True, help="comma-separated agent ids")

    return ap


def _run_context(args: argparse.Namespace, cwd: Optional[str]) -> Any:
    action = args.action or "list"
    if action == "list":
        return context_list(cwd)
    if action == "get":
        if not args.key:
            raise CommsError("context get requires a key")
        return context_get(args.key, cwd)
    if action == "set":
        if not args.key:
            raise CommsError("context set requires a key")
        if args.value is None:
            raise CommsError("context set requires a value")
        return context_set(args.key, _parse_value(args.value), cwd)
    if action == "clear":
        return context_clear(cwd)
    if action == "snapshot":
        return snapshot_context(cwd)
    raise CommsError(f"unknown context action: {action}")


def main(argv: Optional[list[str]] = None) -> int:
    ap = build_parser()
    try:
        args = ap.parse_args(argv)
    except SystemExit as ex:
        code = ex.code if isinstance(ex.code, int) else 2
        if code != 0:
            _print_json({"ok": False, "error": "invalid arguments"})
        return code if isinstance(code, int) else 2

    try:
        cwd = _bind_store(args)
        cmd = args.cmd
        if cmd == "init":
            root = init_comms(cwd)
            _print_json({
                "ok": True,
                "dir": str(root),
                "channels": list(DEFAULT_CHANNELS),
            })
        elif cmd == "post":
            _print_json(post_message(
                from_agent=args.from_agent,
                body=args.body,
                channel=args.channel,
                to=args.to_agent,
                kind=args.kind,
                mentions=args.mentions or None,
                thread_id=args.thread_id,
                task_id=args.task_id,
                cwd=cwd,
            ))
        elif cmd == "poll":
            _print_json(poll_inbox(
                args.agent, since=args.since, limit=args.limit, cwd=cwd,
            ))
        elif cmd == "ack":
            _print_json(ack(args.agent, args.message_id, cwd=cwd))
        elif cmd == "register":
            caps = [p.strip() for p in (args.capabilities or "").split(",") if p.strip()]
            _print_json(upsert_agent_card({
                "id": args.id,
                "role": args.role,
                "provider": args.provider,
                "model": args.model,
                "capabilities": caps,
                "status": args.status,
            }, cwd=cwd))
        elif cmd == "agents":
            _print_json(list_agents(cwd))
        elif cmd == "channels":
            _print_json(list_channels(cwd))
        elif cmd == "history":
            _print_json(history(channel=args.channel, limit=args.limit, cwd=cwd))
        elif cmd == "context":
            cwd = _bind_store(args) or cwd
            _print_json(_run_context(args, cwd))
        elif cmd == "collision":
            names = [p.strip() for p in args.agents.split(",") if p.strip()]
            _print_json(record_collision(args.path, names, cwd=cwd))
        else:
            raise CommsError(f"unknown command: {cmd}")
        return 0
    except CommsError as ex:
        _print_json({"ok": False, "error": str(ex)})
        return 1
    except Exception as ex:  # pragma: no cover - last-resort CLI guard
        _print_json({"ok": False, "error": f"{type(ex).__name__}: {ex}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
