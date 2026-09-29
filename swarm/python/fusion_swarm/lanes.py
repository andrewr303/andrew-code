r"""Communication Lanes — MetaLoop mailboxes wrapped around HiveBoard.

Keeps the metaloop-facing inbox / workcard / swarm.jsonl surface, but every
``send()`` also lands on the HiveBoard (channel ``hive``, plus a DM when the
recipient is a specific agent). Independent AndrewCode processes talk through
the same SQLite WAL board; JSONL inboxes stay for in-process metaloop callers.

Workcards remain JSON files (collision avoidance). State lives under
``state_root`` (default ``~/.fusion/hive/<session_id>``), never a broken
external paths helper.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .board import BoardError, HiveBoard

# Recipients that mean "post to hive, do not DM".
_BROADCAST = frozenset({"", "*", "all", "hive", "broadcast", "everyone", "swarm"})

# Default identity for mailbox names that are not full AgentIdentity records.
_LANES_PROVIDER = "fusion"
_LANES_MODEL = "lanes"


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _default_state_root(session_id: str) -> Path:
    return Path.home() / ".fusion" / "hive" / session_id


@dataclass
class SwarmEvent:
    ts: str
    type: str  # spawn | mail | ack | nack | blocked | progress | merged | status
    from_actor: str
    to_actor: Optional[str] = None
    detail: str = ""
    sessionId: str = ""
    wave: int = 1

    def dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "ts": self.ts,
            "type": self.type,
            "from": self.from_actor,
            "detail": self.detail,
            "sessionId": self.sessionId,
            "wave": self.wave,
        }
        if self.to_actor:
            d["to"] = self.to_actor
        return d


@dataclass
class Message:
    id: str
    from_agent: str
    to_agent: str
    subject: str
    body: str
    msg_type: str = "task"  # task | result | directive | critique | ack | nack | status | query | reply
    status: str = "pending"  # pending | delivered | acknowledged | completed
    correlation_id: Optional[str] = None
    session_id: str = ""
    created_at: str = field(default_factory=_iso_now)
    delivered_at: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Workcard:
    card_id: str
    task_id: str
    agent_id: str
    claimed_paths: list[str] = field(default_factory=list)
    status: str = "active"  # active | submitted | verified | released
    created_at: str = field(default_factory=_iso_now)
    description: str = ""

    def dict(self) -> dict[str, Any]:
        return asdict(self)


class CommunicationLanes:
    """Orchestrates communication lanes, inboxes, workcards, and the HiveBoard."""

    def __init__(self, session_id: str, state_root: Optional[Path] = None):
        self.session_id = session_id
        self.state_root = Path(state_root) if state_root is not None else _default_state_root(session_id)
        self.root = self.state_root
        self.inbox_dir = self.root / "inbox"
        self.workcard_dir = self.root / "workcards"
        self.swarm_log = self.root / "swarm.jsonl"
        home_hive = Path.home() / ".fusion" / "hive"
        if self.root.parent == home_hive:
            self.global_swarm_log = home_hive / "swarm.jsonl"
        else:
            self.global_swarm_log = self.swarm_log

        self.inbox_dir.mkdir(parents=True, exist_ok=True)
        self.workcard_dir.mkdir(parents=True, exist_ok=True)
        self.is_plano = os.environ.get("PLANO_SESSION") == "plano"

        self.board_path = self.root / "hive.db"
        self.board = HiveBoard(self.board_path)

    def __enter__(self) -> "CommunicationLanes":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def close(self) -> None:
        board = getattr(self, "board", None)
        if board is not None:
            board.close()
            self.board = None  # type: ignore[assignment]

    # --- events ----------------------------------------------------------------

    def emit_event(
        self,
        event_type: str,
        from_actor: str,
        to_actor: Optional[str] = None,
        detail: str = "",
        wave: int = 1,
    ) -> SwarmEvent:
        """Log structured event to swarm.jsonl timeline matching andrewagent convention."""
        ev = SwarmEvent(
            ts=_iso_now(),
            type=event_type,
            from_actor=from_actor,
            to_actor=to_actor,
            detail=detail,
            sessionId=self.session_id,
            wave=wave,
        )
        line = json.dumps(ev.dict(), ensure_ascii=False) + "\n"
        try:
            with open(self.swarm_log, "a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            pass
        if self.global_swarm_log != self.swarm_log:
            try:
                with open(self.global_swarm_log, "a", encoding="utf-8") as f:
                    f.write(line)
            except OSError:
                pass
        return ev

    # --- mail ------------------------------------------------------------------

    def send(
        self,
        from_agent: str,
        to_agent: str,
        body: str,
        *,
        subject: str = "",
        msg_type: str = "task",
        correlation_id: Optional[str] = None,
        wave: int = 1,
        metadata: Optional[dict[str, Any]] = None,
    ) -> Message:
        """Deliver a message envelope into recipient mailbox and onto HiveBoard.

        Always posts to channel ``hive``. When ``to_agent`` is a specific agent
        (not a broadcast token), also opens a DM.
        """
        msg_id = f"msg_{uuid.uuid4().hex[:10]}"
        meta: dict[str, Any] = dict(metadata or {})
        board_rec, dm_rec = self._post_to_board(
            from_agent, to_agent, body, subject=subject, msg_type=msg_type
        )
        if board_rec is not None:
            meta["board_id"] = board_rec["id"]
            meta["board_channel"] = board_rec.get("channel", "hive")
        if dm_rec is not None:
            meta["board_dm_id"] = dm_rec["id"]
            meta["board_dm_channel"] = dm_rec.get("channel")

        msg = Message(
            id=msg_id,
            from_agent=from_agent,
            to_agent=to_agent,
            subject=subject or f"[{msg_type}] {from_agent} -> {to_agent}",
            body=body,
            msg_type=msg_type,
            correlation_id=correlation_id,
            session_id=self.session_id,
            metadata=meta,
        )
        recipient_inbox = self.inbox_dir / f"{to_agent}.jsonl"
        with open(recipient_inbox, "a", encoding="utf-8") as f:
            f.write(json.dumps(msg.dict(), ensure_ascii=False) + "\n")

        self.emit_event(
            event_type="mail",
            from_actor=from_agent,
            to_actor=to_agent,
            detail=f"{subject or msg_type} ({len(body)} chars)",
            wave=wave,
        )

        if self.is_plano and shutil.which("plano"):
            try:
                subprocess.run(
                    ["plano", "send", to_agent, f"[{msg_type}] {subject}: {body[:200]}"],
                    capture_output=True,
                    timeout=5,
                    check=False,
                )
            except Exception:
                pass

        return msg

    def check_inbox(self, agent_id: str, mark_delivered: bool = True) -> list[Message]:
        """Fetch pending messages for an agent (jsonl mailbox + board DMs/mentions)."""
        self._ensure_agent(agent_id)
        messages = self._read_jsonl_inbox(agent_id, mark_delivered=mark_delivered)
        seen_board_ids = self._seen_board_ids(agent_id)
        for rec in self._poll_inbox_from_board(agent_id, mark_delivered=mark_delivered):
            bid = rec.get("id")
            if bid in seen_board_ids:
                continue
            msg = self._message_from_board(agent_id, rec, mark_delivered=mark_delivered)
            messages.append(msg)
            seen_board_ids.add(bid)
            if mark_delivered:
                self._append_jsonl(agent_id, msg)
        return messages

    def ack_message(self, agent_id: str, msg_id: str, wave: int = 1) -> bool:
        """Acknowledge message processing (jsonl mailbox and HiveBoard acks)."""
        recipient_inbox = self.inbox_dir / f"{agent_id}.jsonl"
        updated = False
        board_ids: list[int] = []
        if recipient_inbox.is_file():
            new_lines: list[str] = []
            for line in recipient_inbox.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if data.get("id") == msg_id:
                        data["status"] = "acknowledged"
                        updated = True
                        board_ids.extend(self._board_ids_from_record(data, msg_id))
                    new_lines.append(json.dumps(data, ensure_ascii=False))
                except Exception:
                    new_lines.append(line)
            if updated:
                recipient_inbox.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
        if not board_ids:
            board_ids.extend(self._board_ids_from_record({}, msg_id))
        acked_board = False
        if board_ids:
            self._ensure_agent(agent_id)
            for bid in dict.fromkeys(board_ids):
                try:
                    self.board.ack(agent_id, bid)
                    acked_board = True
                except BoardError:
                    continue
        if updated or acked_board:
            self.emit_event(
                event_type="ack",
                from_actor=agent_id,
                detail=f"ack message {msg_id}",
                wave=wave,
            )
            return True
        return False

    def poll(
        self, agent_id: str, since_id: Optional[int] = None, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Poll HiveBoard as ``agent_id`` (auto-registers the mailbox identity)."""
        self._ensure_agent(agent_id)
        return self.board.poll(agent_id, since_id=since_id, limit=limit)

    # --- workcards -------------------------------------------------------------

    def claim_paths(
        self,
        agent_id: str,
        task_id: str,
        paths: list[str],
        description: str = "",
        wave: int = 1,
    ) -> tuple[bool, Optional[str]]:
        """Prevent collision between parallel workers by claiming file paths (andrewagent pattern)."""
        clean_paths = [p.replace("\\", "/").strip() for p in paths if p.strip()]
        for card_file in self.workcard_dir.glob("*.json"):
            try:
                card_data = json.loads(card_file.read_text(encoding="utf-8"))
                if card_data.get("status") == "active" and card_data.get("agent_id") != agent_id:
                    claimed = set(card_data.get("claimed_paths", []))
                    overlap = claimed.intersection(clean_paths)
                    if overlap:
                        conflict_msg = f"Path collision: {sorted(overlap)} already claimed by {card_data.get('agent_id')}"
                        self.emit_event(
                            event_type="blocked",
                            from_actor=agent_id,
                            to_actor=card_data.get("agent_id"),
                            detail=conflict_msg,
                            wave=wave,
                        )
                        return False, conflict_msg
            except Exception:
                continue

        card_id = f"wc_{uuid.uuid4().hex[:8]}"
        card = Workcard(
            card_id=card_id,
            task_id=task_id,
            agent_id=agent_id,
            claimed_paths=clean_paths,
            description=description,
        )
        card_path = self.workcard_dir / f"{card_id}.json"
        card_path.write_text(json.dumps(card.dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

        self.emit_event(
            event_type="spawn",
            from_actor=agent_id,
            detail=f"claimed task {task_id}: {clean_paths}",
            wave=wave,
        )
        return True, card_id

    def release_workcard(self, card_id: str, outcome: str = "merged", wave: int = 1) -> bool:
        """Release workcard claims when task completes or fails."""
        card_path = self.workcard_dir / f"{card_id}.json"
        if not card_path.is_file():
            return False

        try:
            data = json.loads(card_path.read_text(encoding="utf-8"))
            data["status"] = outcome
            card_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
            self.emit_event(
                event_type="merged" if outcome == "merged" else "ack",
                from_actor=data.get("agent_id", "worker"),
                detail=f"released card {card_id} with outcome {outcome}",
                wave=wave,
            )
            return True
        except Exception:
            return False

    def get_timeline(self, limit: int = 50) -> list[dict[str, Any]]:
        """Read recent events from swarm.jsonl."""
        if not self.swarm_log.is_file():
            return []
        events: list[dict[str, Any]] = []
        try:
            lines = self.swarm_log.read_text(encoding="utf-8").splitlines()
            for line in lines[-limit:]:
                line = line.strip()
                if line:
                    events.append(json.loads(line))
        except Exception:
            pass
        return events

    def format_timeline(self, limit: int = 30) -> list[str]:
        """Format events into andrewagent standard pane lines: HH:MM TYPE FROM->TO DETAIL."""
        events = self.get_timeline(limit)
        out: list[str] = []
        for e in events:
            ts = str(e.get("ts", ""))
            time_str = ts[11:16] if len(ts) >= 16 else "--:--"
            actor = f"{e.get('from', '')} -> {e.get('to', '')}" if e.get("to") else str(e.get("from", "-"))
            ev_type = str(e.get("type", "status")).ljust(8)
            wave = f" w{e.get('wave')}" if e.get("wave") else ""
            out.append(f"{time_str}  {ev_type}  {actor.ljust(26)}  {e.get('detail', '')}{wave}")
        return out

    # --- board helpers ---------------------------------------------------------

    def _is_specific_agent(self, to_agent: str) -> bool:
        return str(to_agent or "").strip().lower() not in _BROADCAST

    def _infer_role(self, agent_id: str) -> str:
        n = agent_id.lower()
        if "architect" in n or n in ("arch", "fable", "astra"):
            return "architect"
        if "operator" in n or n in ("host", "co", "chief"):
            return "operator"
        if "captain" in n:
            return "captain"
        if "child" in n:
            return "child"
        return "worker"

    def _ensure_agent(self, agent_id: str) -> None:
        agent_id = str(agent_id).strip()
        if not agent_id:
            raise BoardError("agent_id must be a non-empty string")
        known = {a["id"] for a in self.board.agents()}
        if agent_id in known:
            try:
                self.board.heartbeat(agent_id)
            except BoardError:
                pass
            return
        self.board.register(
            {
                "id": agent_id,
                "display_name": agent_id,
                "role": self._infer_role(agent_id),
                "provider": _LANES_PROVIDER,
                "model": _LANES_MODEL,
                "status": "online",
            }
        )

    def _board_body(self, body: str, subject: str, msg_type: str) -> str:
        text = body if isinstance(body, str) else str(body)
        if text.strip():
            if subject and subject not in text:
                return f"{subject}\n\n{text}"
            return text
        if subject.strip():
            return subject
        return f"[{msg_type}]"

    def _post_to_board(
        self,
        from_agent: str,
        to_agent: str,
        body: str,
        *,
        subject: str,
        msg_type: str,
    ) -> tuple[Optional[dict[str, Any]], Optional[dict[str, Any]]]:
        self._ensure_agent(from_agent)
        specific = self._is_specific_agent(to_agent)
        if specific:
            self._ensure_agent(to_agent)
        board_body = self._board_body(body, subject, msg_type)
        posted = self.board.post(
            from_agent=from_agent,
            body=board_body,
            channel="hive",
            to_agent=to_agent if specific else None,
            mentions=[to_agent] if specific else None,
            kind="message",
        )
        dm_posted = None
        if specific and to_agent != from_agent:
            dm_posted = self.board.dm(from_agent, to_agent, board_body)
        return posted, dm_posted

    def _cursor_path(self, agent_id: str) -> Path:
        return self.inbox_dir / f"{agent_id}.board_cursor"

    def _read_cursor(self, agent_id: str) -> Optional[int]:
        path = self._cursor_path(agent_id)
        if not path.is_file():
            return None
        try:
            raw = path.read_text(encoding="utf-8").strip()
            return int(raw) if raw else None
        except (OSError, ValueError):
            return None

    def _write_cursor(self, agent_id: str, since_id: int) -> None:
        try:
            self._cursor_path(agent_id).write_text(str(since_id), encoding="utf-8")
        except OSError:
            pass

    def _read_jsonl_inbox(self, agent_id: str, mark_delivered: bool) -> list[Message]:
        recipient_inbox = self.inbox_dir / f"{agent_id}.jsonl"
        if not recipient_inbox.is_file():
            return []
        messages: list[Message] = []
        updated_lines: list[str] = []
        try:
            lines = recipient_inbox.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                msg = Message(**data)
                if msg.status == "pending":
                    if mark_delivered:
                        msg.status = "delivered"
                        msg.delivered_at = _iso_now()
                    messages.append(msg)
                updated_lines.append(json.dumps(msg.dict(), ensure_ascii=False))
            except Exception:
                updated_lines.append(line)
        if mark_delivered and messages:
            try:
                recipient_inbox.write_text("\n".join(updated_lines) + "\n", encoding="utf-8")
            except OSError:
                pass
        return messages

    def _seen_board_ids(self, agent_id: str) -> set[Any]:
        seen: set[Any] = set()
        path = self.inbox_dir / f"{agent_id}.jsonl"
        if not path.is_file():
            return seen
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return seen
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                continue
            md = data.get("metadata") or {}
            for key in ("board_id", "board_dm_id"):
                if md.get(key) is not None:
                    seen.add(md[key])
            mid = str(data.get("id") or "")
            if mid.startswith("board_"):
                try:
                    seen.add(int(mid[6:]))
                except ValueError:
                    pass
        return seen

    def _poll_inbox_from_board(
        self, agent_id: str, mark_delivered: bool
    ) -> list[dict[str, Any]]:
        since_id = self._read_cursor(agent_id)
        try:
            recs = self.board.poll(agent_id, since_id=since_id, limit=100)
        except BoardError:
            return []
        inboxish: list[dict[str, Any]] = []
        max_id = since_id or 0
        for rec in recs:
            rid = rec.get("id")
            if isinstance(rid, int) and rid > max_id:
                max_id = rid
            if rec.get("from_agent") == agent_id and rec.get("to_agent") != agent_id:
                # Outbound hive/DM copies are not inbox mail.
                if agent_id not in (rec.get("mentions") or []):
                    continue
            channel = str(rec.get("channel") or "")
            for_me = (
                rec.get("to_agent") == agent_id
                or agent_id in (rec.get("mentions") or [])
                or (channel.startswith("dm:") and rec.get("from_agent") != agent_id)
            )
            if for_me:
                inboxish.append(rec)
        if mark_delivered and max_id:
            self._write_cursor(agent_id, max_id)
        return inboxish

    def _message_from_board(
        self, agent_id: str, rec: dict[str, Any], mark_delivered: bool
    ) -> Message:
        bid = rec.get("id")
        status = "delivered" if mark_delivered else "pending"
        return Message(
            id=f"board_{bid}",
            from_agent=str(rec.get("from_agent") or ""),
            to_agent=str(rec.get("to_agent") or agent_id),
            subject="",
            body=str(rec.get("body") or ""),
            msg_type="status" if rec.get("kind") == "system" else "task",
            status=status,
            session_id=self.session_id,
            delivered_at=_iso_now() if mark_delivered else None,
            metadata={
                "board_id": bid,
                "board_channel": rec.get("channel"),
            },
        )

    def _append_jsonl(self, agent_id: str, msg: Message) -> None:
        path = self.inbox_dir / f"{agent_id}.jsonl"
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(msg.dict(), ensure_ascii=False) + "\n")
        except OSError:
            pass

    def _board_ids_from_record(self, data: dict[str, Any], msg_id: str) -> list[int]:
        ids: list[int] = []
        md = data.get("metadata") or {}
        for key in ("board_id", "board_dm_id"):
            val = md.get(key)
            if isinstance(val, int) and not isinstance(val, bool):
                ids.append(val)
        if msg_id.startswith("board_"):
            try:
                ids.append(int(msg_id[6:]))
            except ValueError:
                pass
        return ids
