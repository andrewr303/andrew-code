"""Direct Worker Steering — attach, interrupt, and redirect running workers.

Ported from CAO's supervisor-worker architecture and adapted for Fusion's
CLI-subprocess model. Unlike traditional "sub-agent" features where the
parent fires and forgets, Fusion Steering lets the supervisor:

  1. **Attach** to an in-flight worker session and send mid-task instructions.
  2. **Interrupt** a running worker (cancel the ongoing subprocess).
  3. **Send follow-up** messages that arrive in the worker's inbox and are
     delivered when the worker next reaches an IDLE state.

The steering layer sits alongside the hierarchical supervisor-worker pattern
(see ``hierarchical.py``) and the agency context (see ``agency_context.py``)
to form a complete orchestration surface.
"""

from __future__ import annotations

import json
import os
import signal
import subprocess
import threading
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------

@dataclass
class WorkerSession:
    """A single worker session, tracked by the steering registry."""
    session_id: str                          # unique ID (worker-{uuid})
    worker_profile: str                      # agent profile name / provider
    status: str = "idle"                     # idle | running | blocked | completed
    task: str = ""                           # current task description
    supervisor_id: str = ""                  # parent session ID
    created_at: str = ""
    pid: int = 0                             # OS process ID (0 if unknown)
    terminal_id: str = ""                    # terminal / window ID if applicable
    extra_context: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "WorkerSession":
        return cls(
            session_id=d.get("session_id", ""),
            worker_profile=d.get("worker_profile", ""),
            status=d.get("status", "idle"),
            task=d.get("task", ""),
            supervisor_id=d.get("supervisor_id", ""),
            created_at=d.get("created_at", ""),
            pid=d.get("pid", 0),
            terminal_id=d.get("terminal_id", ""),
            extra_context=d.get("extra_context", {}),
        )


@dataclass
class InboxMessage:
    """A queued message for a worker."""
    message_id: str
    sender_id: str                          # who sent it
    receiver_id: str                        # who receives it
    content: str
    sent_at: str
    delivered: bool = False
    delivery_type: str = "queued"           # queued | eager | broadcast

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "InboxMessage":
        return cls(
            message_id=d.get("message_id", ""),
            sender_id=d.get("sender_id", ""),
            receiver_id=d.get("receiver_id", ""),
            content=d.get("content", ""),
            sent_at=d.get("sent_at", ""),
            delivered=d.get("delivered", False),
            delivery_type=d.get("delivery_type", "queued"),
        )


@dataclass
class SteeringResult:
    """Outcome of a steering action."""
    action: str                              # attach | interrupt | send | status
    worker_id: str
    success: bool
    message: str
    worker_output: str = ""                  # captured output if applicable
    timestamp: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Steering Registry — process-global worker tracker
# ---------------------------------------------------------------------------

class WorkerRegistry:
    """Tracks all active workers in this process. Thread-safe.

    In Fusion's architecture, a "worker" is a CLI subprocess launched by
    the Python engine. The registry stores metadata so the supervisor can
    attach, send messages, or cancel them.
    """

    _lock = threading.Lock()
    _workers: dict[str, WorkerSession] = {}
    _inboxes: dict[str, list[InboxMessage]] = {}
    _processes: dict[str, subprocess.Popen] = {}

    # --- Registration ---

    @classmethod
    def register(cls, worker: WorkerSession) -> None:
        with cls._lock:
            if not worker.created_at:
                worker.created_at = datetime.now(timezone.utc).isoformat()
            cls._workers[worker.session_id] = worker
            if worker.session_id not in cls._inboxes:
                cls._inboxes[worker.session_id] = []

    @classmethod
    def unregister(cls, session_id: str) -> Optional[WorkerSession]:
        with cls._lock:
            w = cls._workers.pop(session_id, None)
            cls._inboxes.pop(session_id, None)
            cls._processes.pop(session_id, None)
            return w

    @classmethod
    def get(cls, session_id: str) -> Optional[WorkerSession]:
        with cls._lock:
            return cls._workers.get(session_id)

    @classmethod
    def list_by_supervisor(cls, supervisor_id: str) -> list[WorkerSession]:
        with cls._lock:
            return [w for w in cls._workers.values() if w.supervisor_id == supervisor_id]

    @classmethod
    def all(cls) -> list[WorkerSession]:
        with cls._lock:
            return list(cls._workers.values())

    # --- Status management ---

    @classmethod
    def set_status(cls, session_id: str, status: str, task: str = "") -> None:
        with cls._lock:
            w = cls._workers.get(session_id)
            if w:
                w.status = status
                if task:
                    w.task = task

    # --- Process tracking ---

    @classmethod
    def attach_process(cls, session_id: str, proc: subprocess.Popen) -> None:
        with cls._lock:
            cls._processes[session_id] = proc
            w = cls._workers.get(session_id)
            if w:
                w.pid = proc.pid

    # --- Inbox ---

    @classmethod
    def send_message(
        cls,
        sender_id: str,
        receiver_id: str,
        content: str,
        delivery_type: str = "queued",
    ) -> InboxMessage:
        """Queue a message for delivery to a worker. ``receiver_id`` defaults
        to the worker that *created* the sender (its supervisor)."""
        msg = InboxMessage(
            message_id=f"msg-{int(time.time() * 1000)}",
            sender_id=sender_id,
            receiver_id=receiver_id,
            content=content,
            sent_at=datetime.now(timezone.utc).isoformat(),
            delivery_type=delivery_type,
        )
        with cls._lock:
            if receiver_id not in cls._inboxes:
                cls._inboxes[receiver_id] = []
            cls._inboxes[receiver_id].append(msg)
        return msg

    @classmethod
    def drain_inbox(cls, session_id: str) -> list[InboxMessage]:
        """Claim all pending messages for a worker, marking them delivered."""
        with cls._lock:
            msgs = cls._inboxes.pop(session_id, [])
            for m in msgs:
                m.delivered = True
            return msgs

    @classmethod
    def peek_inbox(cls, session_id: str) -> list[InboxMessage]:
        with cls._lock:
            return list(cls._inboxes.get(session_id, []))


# ---------------------------------------------------------------------------
# Steering actions
# ---------------------------------------------------------------------------

def attach_worker(worker_id: str) -> SteeringResult:
    """Attach to a running worker — returns its current status and task.
    The supervisor can then decide to interrupt, redirect, or inspect."""
    w = WorkerRegistry.get(worker_id)
    if not w:
        return SteeringResult(
            action="attach", worker_id=worker_id, success=False,
            message=f"Worker '{worker_id}' not found in registry.",
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
    return SteeringResult(
        action="attach", worker_id=worker_id, success=True,
        message=f"Attached to worker '{w.worker_profile}' (status: {w.status}, task: {w.task[:80]})",
        timestamp=datetime.now(timezone.utc).isoformat(),
    )


def interrupt_worker(worker_id: str, timeout_seconds: int = 5) -> SteeringResult:
    """Attempt to interrupt a running worker process.

    Sends SIGTERM (or CTRL_BREAK_EVENT on Windows), then optionally waits
    for exit. Returns captured output if available.
    """
    w = WorkerRegistry.get(worker_id)
    proc = WorkerRegistry._processes.get(worker_id)
    ts = datetime.now(timezone.utc).isoformat()

    if not w:
        return SteeringResult(action="interrupt", worker_id=worker_id, success=False,
                             message="Worker not found.", timestamp=ts)

    if not proc or proc.poll() is not None:
        WorkerRegistry.set_status(worker_id, "completed")
        return SteeringResult(action="interrupt", worker_id=worker_id, success=True,
                             message="Worker already finished.", timestamp=ts)

    try:
        if os.name == "nt":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            proc.terminate()
        try:
            proc.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)
        WorkerRegistry.set_status(worker_id, "completed")
        return SteeringResult(
            action="interrupt", worker_id=worker_id, success=True,
            message=f"Worker '{w.worker_profile}' interrupted.",
            timestamp=ts,
        )
    except Exception as exc:
        return SteeringResult(
            action="interrupt", worker_id=worker_id, success=False,
            message=f"Interrupt failed: {exc}", timestamp=ts,
        )


def steer_worker(worker_id: str, instruction: str) -> SteeringResult:
    """Send a steering message to a running worker — delivered immediately
    as an inbox message (eager delivery). The worker will process this
    as context on its next response cycle."""
    w = WorkerRegistry.get(worker_id)
    ts = datetime.now(timezone.utc).isoformat()

    if not w:
        return SteeringResult(action="steer", worker_id=worker_id, success=False,
                             message="Worker not found.", timestamp=ts)

    if w.status not in ("running", "idle"):
        return SteeringResult(action="steer", worker_id=worker_id, success=False,
                             message=f"Cannot steer worker in status '{w.status}'.",
                             timestamp=ts)

    WorkerRegistry.send_message(
        sender_id=w.supervisor_id or "supervisor",
        receiver_id=worker_id,
        content=instruction,
        delivery_type="eager",
    )
    return SteeringResult(
        action="steer", worker_id=worker_id, success=True,
        message=f"Steering instruction sent to '{w.worker_profile}'.",
        timestamp=ts,
    )


def worker_status(worker_id: str = "") -> list[dict[str, Any]]:
    """Return status of one or all workers."""
    if worker_id:
        w = WorkerRegistry.get(worker_id)
        return [w.to_dict()] if w else []
    return [w.to_dict() for w in WorkerRegistry.all()]


# ---------------------------------------------------------------------------
# Module-level convenience functions
# ---------------------------------------------------------------------------

def attach(worker_id: str) -> dict[str, Any]:
    return attach_worker(worker_id).to_dict()


def interrupt(worker_id: str, timeout: int = 5) -> dict[str, Any]:
    return interrupt_worker(worker_id, timeout).to_dict()


def steer(worker_id: str, instruction: str) -> dict[str, Any]:
    return steer_worker(worker_id, instruction).to_dict()


def status(worker_id: str = "") -> list[dict[str, Any]]:
    return worker_status(worker_id)


def register_worker(
    worker_id: str, profile: str, supervisor_id: str = "",
    task: str = "", pid: int = 0,
) -> WorkerSession:
    ws = WorkerSession(
        session_id=worker_id, worker_profile=profile,
        supervisor_id=supervisor_id, task=task, pid=pid,
        status="running",
    )
    WorkerRegistry.register(ws)
    return ws
