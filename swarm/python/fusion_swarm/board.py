"""HiveBoard — file + SQLite WAL message bus for nested Fusion swarms.

Independent AndrewCode / CLI processes talk through one board. There is no
daemon: every process opens the same SQLite file (WAL so readers never block
writers) and a sibling JSONL file for greppability.

This is the Slack-channel + forum hybrid the architect/host uses internally.
It is not human-facing except via the architect. Default rooms on init:

    hive        everyone
    architect   architect seat
    captains    captains
    workers     workers / children
    system      system events

Stdlib only. Fail-closed: unknown channel kinds, missing agents, empty bodies,
and unknown CLI verbs are errors, never silently coerced.
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import threading
import time
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

# Channel kinds the contract names. Fail closed on anything else.
CHANNEL_KINDS = ("room", "dm", "thread", "lineage", "task")
MESSAGE_KINDS = ("message", "system", "ack", "presence")
DEFAULT_CHANNELS = ("hive", "architect", "captains", "workers", "system")
AGENT_ROLES = ("architect", "operator", "captain", "worker", "child")
AGENT_STATUSES = ("online", "offline", "busy", "idle", "error")

# Role -> default rooms an agent is auto-joined to on register.
_ROLE_ROOMS = {
    "architect": ("hive", "architect", "system"),
    "operator": ("hive", "architect", "captains", "system"),
    "captain": ("hive", "captains"),
    "worker": ("hive", "workers"),
    "child": ("hive", "workers"),
}


class BoardError(ValueError):
    """Raised when a HiveBoard operation is rejected. Fail-closed."""


def _now() -> str:
    # Local wall time as ISO-8601 with seconds. Independent processes only need
    # a stable sortable stamp; SQLite INTEGER ids are the real order.
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def _as_agent_dict(agent: Any) -> dict[str, Any]:
    """Accept AgentIdentity dataclass, a duck with asdict, or a plain dict."""
    if is_dataclass(agent) and not isinstance(agent, type):
        d = asdict(agent)
    elif hasattr(agent, "to_dict") and callable(agent.to_dict):
        d = agent.to_dict()
    elif isinstance(agent, dict):
        d = dict(agent)
    else:
        raise BoardError("agent must be a dict or AgentIdentity")
    return d


def _require_str(value: Any, name: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str):
        raise BoardError(f"{name} must be a string")
    if not allow_empty and not value.strip():
        raise BoardError(f"{name} must be a non-empty string")
    return value


def _json_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        # CLI convenience: comma-separated mentions.
        parts = [p.strip() for p in value.split(",") if p.strip()]
        return parts
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            if not isinstance(item, str) or not item.strip():
                raise BoardError("mentions must be a list of non-empty strings")
            out.append(item.strip())
        return out
    raise BoardError("mentions must be a list of strings or a comma-separated string")


def _dm_channel_name(a: str, b: str) -> str:
    x, y = sorted((a, b))
    return f"dm:{x}:{y}"


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {k: row[k] for k in row.keys()}


def _parse_mentions_field(raw: Any) -> list[str]:
    if not raw:
        return []
    if isinstance(raw, list):
        return list(raw)
    try:
        parsed = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    if isinstance(parsed, list):
        return [str(x) for x in parsed]
    return []


class HiveBoard:
    """SQLite WAL hive board. One file, many independent processes.

    Usage::

        with HiveBoard(path) as board:
            board.register({"id": "arch", "role": "architect", ...})
            board.post(from_agent="arch", body="hello", channel="hive")
    """

    def __init__(self, path: str | os.PathLike[str]):
        self.path = str(Path(path))
        parent = os.path.dirname(os.path.abspath(self.path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        self.jsonl_path = self.path + ".jsonl"
        # check_same_thread=False so a board opened on one thread can be used
        # from ThreadPoolExecutor workers (fusion_swarm style). WAL + our
        # write lock keep that safe.
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        self._conn.execute("PRAGMA journal_mode = WAL")
        self._conn.execute("PRAGMA synchronous = NORMAL")
        self._lock = threading.RLock()
        self.init_schema()

    def __enter__(self) -> "HiveBoard":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    # --- schema -------------------------------------------------------------

    def init_schema(self) -> None:
        with self._lock:
            self._conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS agents (
                    id          TEXT PRIMARY KEY,
                    display_name TEXT NOT NULL,
                    role        TEXT NOT NULL,
                    provider    TEXT NOT NULL,
                    model       TEXT NOT NULL,
                    parent_id   TEXT,
                    lineage     TEXT NOT NULL DEFAULT '',
                    depth       INTEGER NOT NULL DEFAULT 0,
                    spawn_budget INTEGER NOT NULL DEFAULT 0,
                    max_depth   INTEGER NOT NULL DEFAULT 2,
                    status      TEXT NOT NULL DEFAULT 'online',
                    registered_at TEXT NOT NULL,
                    last_seen   TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS channels (
                    name        TEXT PRIMARY KEY,
                    kind        TEXT NOT NULL,
                    created_by  TEXT NOT NULL,
                    created_at  TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS channel_members (
                    channel     TEXT NOT NULL,
                    agent_id    TEXT NOT NULL,
                    joined_at   TEXT NOT NULL,
                    PRIMARY KEY (channel, agent_id),
                    FOREIGN KEY (channel) REFERENCES channels(name),
                    FOREIGN KEY (agent_id) REFERENCES agents(id)
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    channel     TEXT NOT NULL,
                    from_agent  TEXT NOT NULL,
                    to_agent    TEXT,
                    body        TEXT NOT NULL,
                    kind        TEXT NOT NULL DEFAULT 'message',
                    thread_id   INTEGER,
                    mentions    TEXT NOT NULL DEFAULT '[]',
                    created_at  TEXT NOT NULL,
                    FOREIGN KEY (channel) REFERENCES channels(name),
                    FOREIGN KEY (from_agent) REFERENCES agents(id)
                );

                CREATE TABLE IF NOT EXISTS acks (
                    agent_id    TEXT NOT NULL,
                    message_id  INTEGER NOT NULL,
                    acked_at    TEXT NOT NULL,
                    PRIMARY KEY (agent_id, message_id),
                    FOREIGN KEY (agent_id) REFERENCES agents(id),
                    FOREIGN KEY (message_id) REFERENCES messages(id)
                );

                CREATE TABLE IF NOT EXISTS presence (
                    agent_id    TEXT PRIMARY KEY,
                    status      TEXT NOT NULL,
                    last_seen   TEXT NOT NULL,
                    FOREIGN KEY (agent_id) REFERENCES agents(id)
                );
                """
            )
            for name in DEFAULT_CHANNELS:
                self._ensure_channel_unlocked(name, kind="room", created_by="system")
            self._conn.commit()

    # --- agents -------------------------------------------------------------

    def register(self, agent: Any) -> dict[str, Any]:
        d = _as_agent_dict(agent)
        agent_id = _require_str(d.get("id"), "id")
        role = d.get("role") or "worker"
        if role not in AGENT_ROLES:
            raise BoardError(f"role must be one of {AGENT_ROLES}")
        status = d.get("status") or "online"
        if status not in AGENT_STATUSES:
            raise BoardError(f"status must be one of {AGENT_STATUSES}")
        display = d.get("display_name") or agent_id
        provider = d.get("provider") or ""
        model = d.get("model") or ""
        if not isinstance(display, str) or not display.strip():
            raise BoardError("display_name must be a non-empty string")
        if not isinstance(provider, str) or not provider.strip():
            raise BoardError("provider must be a non-empty string")
        if not isinstance(model, str) or not model.strip():
            raise BoardError("model must be a non-empty string")
        parent_id = d.get("parent_id")
        if parent_id is not None and not isinstance(parent_id, str):
            raise BoardError("parent_id must be a string or null")
        if parent_id == "":
            parent_id = None
        lineage = d.get("lineage") if d.get("lineage") is not None else ""
        if not isinstance(lineage, str):
            raise BoardError("lineage must be a string")
        depth = d.get("depth", 0)
        spawn_budget = d.get("spawn_budget", 0)
        max_depth = d.get("max_depth", 2)
        for name, val in (("depth", depth), ("spawn_budget", spawn_budget), ("max_depth", max_depth)):
            if isinstance(val, bool) or not isinstance(val, int):
                raise BoardError(f"{name} must be an integer")
            if val < 0:
                raise BoardError(f"{name} must be >= 0")
        stamp = _now()
        rec = {
            "id": agent_id,
            "display_name": display.strip(),
            "role": role,
            "provider": provider.strip(),
            "model": model.strip(),
            "parent_id": parent_id,
            "lineage": lineage,
            "depth": depth,
            "spawn_budget": spawn_budget,
            "max_depth": max_depth,
            "status": status,
            "registered_at": stamp,
            "last_seen": stamp,
        }
        with self._lock:
            if parent_id is not None:
                parent = self._agent_unlocked(parent_id)
                if parent is None:
                    raise BoardError(f"unknown parent_id: {parent_id}")
            existing = self._agent_unlocked(agent_id)
            if existing is not None:
                self._conn.execute(
                    """
                    UPDATE agents SET
                        display_name=?, role=?, provider=?, model=?,
                        parent_id=?, lineage=?, depth=?, spawn_budget=?,
                        max_depth=?, status=?, last_seen=?
                    WHERE id=?
                    """,
                    (
                        rec["display_name"], rec["role"], rec["provider"], rec["model"],
                        rec["parent_id"], rec["lineage"], rec["depth"], rec["spawn_budget"],
                        rec["max_depth"], rec["status"], stamp, agent_id,
                    ),
                )
                rec["registered_at"] = existing["registered_at"]
                rec["last_seen"] = stamp
            else:
                self._conn.execute(
                    """
                    INSERT INTO agents (
                        id, display_name, role, provider, model, parent_id,
                        lineage, depth, spawn_budget, max_depth, status,
                        registered_at, last_seen
                    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        rec["id"], rec["display_name"], rec["role"], rec["provider"],
                        rec["model"], rec["parent_id"], rec["lineage"], rec["depth"],
                        rec["spawn_budget"], rec["max_depth"], rec["status"],
                        rec["registered_at"], rec["last_seen"],
                    ),
                )
            self._conn.execute(
                """
                INSERT INTO presence (agent_id, status, last_seen)
                VALUES (?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET status=excluded.status,
                    last_seen=excluded.last_seen
                """,
                (agent_id, status, stamp),
            )
            for room in _ROLE_ROOMS.get(role, ("hive",)):
                self._ensure_channel_unlocked(room, kind="room", created_by="system")
                self._join_unlocked(room, agent_id)
            self._conn.commit()
        return rec

    def heartbeat(self, agent_id: str, status: str = "online") -> dict[str, Any]:
        agent_id = _require_str(agent_id, "agent_id")
        if status not in AGENT_STATUSES:
            raise BoardError(f"status must be one of {AGENT_STATUSES}")
        stamp = _now()
        with self._lock:
            if self._agent_unlocked(agent_id) is None:
                raise BoardError(f"unknown agent: {agent_id}")
            self._conn.execute(
                "UPDATE agents SET status=?, last_seen=? WHERE id=?",
                (status, stamp, agent_id),
            )
            self._conn.execute(
                """
                INSERT INTO presence (agent_id, status, last_seen)
                VALUES (?, ?, ?)
                ON CONFLICT(agent_id) DO UPDATE SET status=excluded.status,
                    last_seen=excluded.last_seen
                """,
                (agent_id, status, stamp),
            )
            self._conn.commit()
        return {"id": agent_id, "status": status, "last_seen": stamp}

    def agents(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM agents ORDER BY lineage, id"
            ).fetchall()
        return [_row_to_dict(r) for r in rows]

    def tree(self) -> dict[str, Any]:
        """Parent-id grouping of registered agents.

        Returns ``{"roots": [...], "children": {parent_id: [child, ...]}}``.
        """
        people = self.agents()
        children: dict[str, list[dict[str, Any]]] = {}
        roots: list[dict[str, Any]] = []
        for agent in people:
            parent = agent.get("parent_id")
            if parent:
                children.setdefault(parent, []).append(agent)
            else:
                roots.append(agent)
        return {"roots": roots, "children": children, "agents": people}

    # --- channels -----------------------------------------------------------

    def ensure_channel(
        self, name: str, kind: str = "room", created_by: str = "system"
    ) -> str:
        name = _require_str(name, "name")
        if kind not in CHANNEL_KINDS:
            raise BoardError(f"kind must be one of {CHANNEL_KINDS}")
        created_by = _require_str(created_by, "created_by")
        with self._lock:
            self._ensure_channel_unlocked(name, kind=kind, created_by=created_by)
            self._conn.commit()
        return name

    def join(self, channel: str, agent_id: str) -> dict[str, Any]:
        channel = _require_str(channel, "channel")
        agent_id = _require_str(agent_id, "agent_id")
        with self._lock:
            if self._channel_unlocked(channel) is None:
                raise BoardError(f"unknown channel: {channel}")
            if self._agent_unlocked(agent_id) is None:
                raise BoardError(f"unknown agent: {agent_id}")
            self._join_unlocked(channel, agent_id)
            self._conn.commit()
        return {"channel": channel, "agent_id": agent_id}

    def channels(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM channels ORDER BY name"
            ).fetchall()
        return [_row_to_dict(r) for r in rows]

    # --- messages -----------------------------------------------------------

    def post(
        self,
        *,
        from_agent: str,
        body: str,
        channel: str = "hive",
        thread_id: Optional[int] = None,
        mentions: Any = None,
        to_agent: Optional[str] = None,
        kind: str = "message",
    ) -> dict[str, Any]:
        from_agent = _require_str(from_agent, "from_agent")
        body = _require_str(body, "body")
        channel = _require_str(channel, "channel")
        if kind not in MESSAGE_KINDS:
            raise BoardError(f"kind must be one of {MESSAGE_KINDS}")
        mention_list = _json_list(mentions)
        if to_agent is not None:
            to_agent = _require_str(to_agent, "to_agent")
        if thread_id is not None:
            if isinstance(thread_id, bool) or not isinstance(thread_id, int):
                raise BoardError("thread_id must be an integer or null")
        stamp = _now()
        with self._lock:
            if self._agent_unlocked(from_agent) is None:
                raise BoardError(f"unknown agent: {from_agent}")
            if to_agent is not None and self._agent_unlocked(to_agent) is None:
                raise BoardError(f"unknown to_agent: {to_agent}")
            for mentioned in mention_list:
                if self._agent_unlocked(mentioned) is None:
                    raise BoardError(f"unknown mention: {mentioned}")
            if self._channel_unlocked(channel) is None:
                raise BoardError(f"unknown channel: {channel}")
            if thread_id is not None:
                parent = self._message_unlocked(thread_id)
                if parent is None:
                    raise BoardError(f"unknown thread_id: {thread_id}")
            self._join_unlocked(channel, from_agent)
            if to_agent is not None:
                self._join_unlocked(channel, to_agent)
            cur = self._conn.execute(
                """
                INSERT INTO messages (
                    channel, from_agent, to_agent, body, kind, thread_id,
                    mentions, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    channel, from_agent, to_agent, body, kind, thread_id,
                    json.dumps(mention_list, ensure_ascii=False), stamp,
                ),
            )
            msg_id = int(cur.lastrowid)
            rec = {
                "id": msg_id,
                "channel": channel,
                "from_agent": from_agent,
                "to_agent": to_agent,
                "body": body,
                "kind": kind,
                "thread_id": thread_id,
                "mentions": mention_list,
                "created_at": stamp,
            }
            self._append_jsonl(rec)
            self._conn.commit()
        return rec

    def dm(self, from_agent: str, to_agent: str, body: str) -> dict[str, Any]:
        from_agent = _require_str(from_agent, "from_agent")
        to_agent = _require_str(to_agent, "to_agent")
        if from_agent == to_agent:
            raise BoardError("cannot DM yourself")
        channel = _dm_channel_name(from_agent, to_agent)
        with self._lock:
            if self._agent_unlocked(from_agent) is None:
                raise BoardError(f"unknown agent: {from_agent}")
            if self._agent_unlocked(to_agent) is None:
                raise BoardError(f"unknown to_agent: {to_agent}")
            self._ensure_channel_unlocked(channel, kind="dm", created_by=from_agent)
            self._join_unlocked(channel, from_agent)
            self._join_unlocked(channel, to_agent)
            self._conn.commit()
        return self.post(
            from_agent=from_agent,
            body=body,
            channel=channel,
            to_agent=to_agent,
            kind="message",
        )

    def reply(self, from_agent: str, message_id: int, body: str) -> dict[str, Any]:
        from_agent = _require_str(from_agent, "from_agent")
        body = _require_str(body, "body")
        if isinstance(message_id, bool) or not isinstance(message_id, int):
            raise BoardError("message_id must be an integer")
        with self._lock:
            parent = self._message_unlocked(message_id)
            if parent is None:
                raise BoardError(f"unknown message: {message_id}")
            channel = parent["channel"]
            thread_root = parent["thread_id"] if parent["thread_id"] is not None else parent["id"]
        return self.post(
            from_agent=from_agent,
            body=body,
            channel=channel,
            thread_id=int(thread_root),
            kind="message",
        )

    def poll(
        self, agent_id: str, since_id: Optional[int] = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Messages in channels the agent joined, plus DMs and @mentions.

        Isolation: an agent does not see rooms it never joined, even if those
        rooms have traffic. DMs and @mentions always surface, which is how
        children of different captains talk across lineage.
        """
        agent_id = _require_str(agent_id, "agent_id")
        if since_id is not None and (isinstance(since_id, bool) or not isinstance(since_id, int)):
            raise BoardError("since_id must be an integer or null")
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            raise BoardError("limit must be a positive integer")
        with self._lock:
            if self._agent_unlocked(agent_id) is None:
                raise BoardError(f"unknown agent: {agent_id}")
            joined = {
                r["channel"]
                for r in self._conn.execute(
                    "SELECT channel FROM channel_members WHERE agent_id = ?",
                    (agent_id,),
                ).fetchall()
            }
            params: list[Any] = []
            since_sql = ""
            if since_id is not None:
                since_sql = "WHERE id > ?"
                params.append(since_id)
            rows = self._conn.execute(
                f"SELECT * FROM messages {since_sql} ORDER BY id ASC",
                params,
            ).fetchall()
            out: list[dict[str, Any]] = []
            for row in rows:
                rec = self._message_dict(row)
                if (
                    rec["channel"] in joined
                    or rec.get("to_agent") == agent_id
                    or agent_id in (rec.get("mentions") or [])
                ):
                    out.append(rec)
                    if len(out) >= limit:
                        break
            return out

    def mentions(
        self, agent_id: str, since_id: Optional[int] = None
    ) -> list[dict[str, Any]]:
        agent_id = _require_str(agent_id, "agent_id")
        if since_id is not None and (isinstance(since_id, bool) or not isinstance(since_id, int)):
            raise BoardError("since_id must be an integer or null")
        with self._lock:
            if self._agent_unlocked(agent_id) is None:
                raise BoardError(f"unknown agent: {agent_id}")
            params: list[Any] = [f'%"{agent_id}"%', agent_id]
            since_sql = ""
            if since_id is not None:
                since_sql = "AND id > ?"
                params.append(since_id)
            rows = self._conn.execute(
                f"""
                SELECT * FROM messages
                WHERE (mentions LIKE ? OR to_agent = ?)
                {since_sql}
                ORDER BY id ASC
                """,
                params,
            ).fetchall()
        out = []
        for row in rows:
            rec = self._message_dict(row)
            if agent_id in (rec.get("mentions") or []) or rec.get("to_agent") == agent_id:
                out.append(rec)
        return out

    def ack(self, agent_id: str, message_id: int) -> dict[str, Any]:
        agent_id = _require_str(agent_id, "agent_id")
        if isinstance(message_id, bool) or not isinstance(message_id, int):
            raise BoardError("message_id must be an integer")
        stamp = _now()
        with self._lock:
            if self._agent_unlocked(agent_id) is None:
                raise BoardError(f"unknown agent: {agent_id}")
            if self._message_unlocked(message_id) is None:
                raise BoardError(f"unknown message: {message_id}")
            self._conn.execute(
                """
                INSERT INTO acks (agent_id, message_id, acked_at)
                VALUES (?, ?, ?)
                ON CONFLICT(agent_id, message_id) DO UPDATE SET acked_at=excluded.acked_at
                """,
                (agent_id, message_id, stamp),
            )
            self._conn.commit()
        return {"agent_id": agent_id, "message_id": message_id, "acked_at": stamp}

    def format_feed(self, messages: Iterable[dict[str, Any]]) -> str:
        lines: list[str] = []
        for msg in messages:
            mid = msg.get("id", "?")
            channel = msg.get("channel", "?")
            author = msg.get("from_agent", "?")
            body = msg.get("body", "")
            thread = msg.get("thread_id")
            mentions = msg.get("mentions") or []
            stamp = msg.get("created_at", "")
            prefix = f"#{channel}"
            if thread is not None:
                prefix += f" ↩{thread}"
            mention_s = ""
            if mentions:
                mention_s = " @" + " @".join(mentions)
            dest = ""
            if msg.get("to_agent"):
                dest = f" → {msg['to_agent']}"
            lines.append(f"[{mid}] {stamp} {prefix} {author}{dest}{mention_s}: {body}")
        return "\n".join(lines)

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except sqlite3.Error:
                pass

    # --- internals ----------------------------------------------------------

    def _agent_unlocked(self, agent_id: str) -> Optional[dict[str, Any]]:
        row = self._conn.execute(
            "SELECT * FROM agents WHERE id = ?", (agent_id,)
        ).fetchone()
        return _row_to_dict(row) if row is not None else None

    def _channel_unlocked(self, name: str) -> Optional[dict[str, Any]]:
        row = self._conn.execute(
            "SELECT * FROM channels WHERE name = ?", (name,)
        ).fetchone()
        return _row_to_dict(row) if row is not None else None

    def _message_unlocked(self, message_id: int) -> Optional[dict[str, Any]]:
        row = self._conn.execute(
            "SELECT * FROM messages WHERE id = ?", (message_id,)
        ).fetchone()
        return self._message_dict(row) if row is not None else None

    def _ensure_channel_unlocked(
        self, name: str, kind: str = "room", created_by: str = "system"
    ) -> None:
        existing = self._channel_unlocked(name)
        if existing is None:
            self._conn.execute(
                """
                INSERT INTO channels (name, kind, created_by, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (name, kind, created_by, _now()),
            )
        elif existing["kind"] != kind:
            raise BoardError(
                f"channel {name!r} already exists as kind {existing['kind']!r}"
            )

    def _join_unlocked(self, channel: str, agent_id: str) -> None:
        self._conn.execute(
            """
            INSERT OR IGNORE INTO channel_members (channel, agent_id, joined_at)
            VALUES (?, ?, ?)
            """,
            (channel, agent_id, _now()),
        )

    def _message_dict(self, row: sqlite3.Row) -> dict[str, Any]:
        d = _row_to_dict(row)
        d["mentions"] = _parse_mentions_field(d.get("mentions"))
        return d

    def _append_jsonl(self, rec: dict[str, Any]) -> None:
        line = json.dumps(rec, ensure_ascii=False, separators=(",", ":"))
        with open(self.jsonl_path, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
            fh.flush()
            os.fsync(fh.fileno())


# --- CLI --------------------------------------------------------------------

def _print_json(obj: Any) -> None:
    print(json.dumps(obj, ensure_ascii=False, default=str))


def _int_or_none(value: Optional[str]) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as ex:
        raise BoardError(f"not an integer: {value!r}") from ex


def default_board_db() -> str:
    env = os.environ.get("FUSION_BOARD", "").strip()
    if env:
        return env
    state = os.environ.get("FUSION_STATE_DIR", "").strip()
    root = Path(state) if state else Path.home() / ".fusion"
    return str(root / "hive" / "board.sqlite")


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="fusion_swarm.board",
        description="HiveBoard CLI — always prints JSON.",
    )
    ap.add_argument(
        "--db",
        default=None,
        help="path to the sqlite board file (default: $FUSION_BOARD or ~/.fusion/hive/board.sqlite)",
    )
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("init", help="create schema + default channels")

    p_reg = sub.add_parser("register", help="register or update an agent")
    p_reg.add_argument("--id", required=True)
    p_reg.add_argument("--display-name", dest="display_name", default="")
    p_reg.add_argument("--role", default="worker")
    p_reg.add_argument("--provider", required=True)
    p_reg.add_argument("--model", required=True)
    p_reg.add_argument("--parent-id", dest="parent_id", default=None)
    p_reg.add_argument("--lineage", default="")
    p_reg.add_argument("--depth", type=int, default=0)
    p_reg.add_argument("--spawn-budget", dest="spawn_budget", type=int, default=0)
    p_reg.add_argument("--max-depth", dest="max_depth", type=int, default=2)
    p_reg.add_argument("--status", default="online")

    p_hb = sub.add_parser("heartbeat")
    p_hb.add_argument("--agent", required=True)
    p_hb.add_argument("--status", default="online")

    p_post = sub.add_parser("post")
    p_post.add_argument("--from", dest="from_agent", required=True)
    p_post.add_argument("--body", required=True)
    p_post.add_argument("--channel", default="hive")
    p_post.add_argument("--thread-id", dest="thread_id", default=None)
    p_post.add_argument("--mentions", default="")
    p_post.add_argument("--to", dest="to_agent", default=None)
    p_post.add_argument("--kind", default="message")

    p_dm = sub.add_parser("dm")
    p_dm.add_argument("--from", dest="from_agent", required=True)
    p_dm.add_argument("--to", dest="to_agent", required=True)
    p_dm.add_argument("--body", required=True)

    p_reply = sub.add_parser("reply")
    p_reply.add_argument("--from", dest="from_agent", required=True)
    p_reply.add_argument("--message-id", dest="message_id", type=int, required=True)
    p_reply.add_argument("--body", required=True)

    p_poll = sub.add_parser("poll")
    p_poll.add_argument("--agent", required=True)
    p_poll.add_argument("--since-id", dest="since_id", default=None)
    p_poll.add_argument("--limit", type=int, default=100)

    p_ment = sub.add_parser("mentions")
    p_ment.add_argument("--agent", required=True)
    p_ment.add_argument("--since-id", dest="since_id", default=None)

    sub.add_parser("agents")
    sub.add_parser("tree")
    sub.add_parser("channels")

    p_join = sub.add_parser("join")
    p_join.add_argument("--channel", required=True)
    p_join.add_argument("--agent", required=True)

    p_ack = sub.add_parser("ack")
    p_ack.add_argument("--agent", required=True)
    p_ack.add_argument("--message-id", dest="message_id", type=int, required=True)

    return ap


def main(argv: Optional[list[str]] = None) -> int:
    ap = build_parser()
    try:
        args = ap.parse_args(argv)
    except SystemExit as ex:
        # argparse already printed the error; still emit JSON so callers that
        # always parse stdout don't hang on a human usage string.
        code = ex.code if isinstance(ex.code, int) else 2
        if code != 0:
            _print_json({"ok": False, "error": "invalid arguments"})
        return code if isinstance(code, int) else 2

    try:
        with HiveBoard(args.db or default_board_db()) as board:
            cmd = args.cmd
            if cmd == "init":
                _print_json({"ok": True, "db": board.path, "channels": DEFAULT_CHANNELS})
            elif cmd == "register":
                rec = board.register({
                    "id": args.id,
                    "display_name": args.display_name or args.id,
                    "role": args.role,
                    "provider": args.provider,
                    "model": args.model,
                    "parent_id": args.parent_id or None,
                    "lineage": args.lineage,
                    "depth": args.depth,
                    "spawn_budget": args.spawn_budget,
                    "max_depth": args.max_depth,
                    "status": args.status,
                })
                _print_json(rec)
            elif cmd == "heartbeat":
                _print_json(board.heartbeat(args.agent, status=args.status))
            elif cmd == "post":
                _print_json(board.post(
                    from_agent=args.from_agent,
                    body=args.body,
                    channel=args.channel,
                    thread_id=_int_or_none(args.thread_id),
                    mentions=args.mentions or None,
                    to_agent=args.to_agent,
                    kind=args.kind,
                ))
            elif cmd == "dm":
                _print_json(board.dm(args.from_agent, args.to_agent, args.body))
            elif cmd == "reply":
                _print_json(board.reply(args.from_agent, args.message_id, args.body))
            elif cmd == "poll":
                _print_json(board.poll(
                    args.agent,
                    since_id=_int_or_none(args.since_id),
                    limit=args.limit,
                ))
            elif cmd == "mentions":
                _print_json(board.mentions(
                    args.agent, since_id=_int_or_none(args.since_id)
                ))
            elif cmd == "agents":
                _print_json(board.agents())
            elif cmd == "tree":
                _print_json(board.tree())
            elif cmd == "channels":
                _print_json(board.channels())
            elif cmd == "join":
                _print_json(board.join(args.channel, args.agent))
            elif cmd == "ack":
                _print_json(board.ack(args.agent, args.message_id))
            else:
                raise BoardError(f"unknown command: {cmd}")
        return 0
    except BoardError as ex:
        _print_json({"ok": False, "error": str(ex)})
        return 1
    except Exception as ex:  # pragma: no cover - last-resort CLI guard
        _print_json({"ok": False, "error": f"{type(ex).__name__}: {ex}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
