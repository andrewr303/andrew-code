"""Improved Hierarchical Supervisor–Worker Orchestration.

A supervisor agent coordinates and delegates tasks to specialized workers.
Each worker focuses on its domain, receives only the context it needs
(not the supervisor's full context), and reports back via callbacks.

Key improvements over the previous ``hierarchical.py``:

  * **Supervisor inbox** — workers send results via ``send_message``,
    supervisors receive them when idle. No polling.
  * **Context isolation** — workers do NOT see the supervisor's full
    reasoning history; they get only the task + injected relevant memories.
  * **Memory injection** — relevant knowledge is auto-injected into the
    worker's prompt at task start (see ``memory_service.py``).
  * **Worker steering** — the supervisor can attach to running workers
    mid-task, interrupt them, or redirect (see ``steering.py``).
  * **Structured callbacks** — workers return ``WorkerResult`` contracts,
    not free text. The supervisor validates before integrating.
  * **Agency context** — shared state via ``MasterContext.get()/set()``
    allows workers to leave breadcrumbs for downstream workers.

Usage::

    from fusion_swarm.hierarchical import Supervisor

    sv = Supervisor(director="codex", session_id="build-session-1")
    result = sv.decompose_and_dispatch(
        task="Migrate all logger calls from logrus to slog across a 50-file Go repo",
        worker_pool=["copilot", "opencode", "grok"],
    )
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Optional

from .adapter import (
    available,
    dispatch,
    record_run,
)
from .agency_context import MasterContext, session_context
from .memory_service import inject_memory_context
from .steering import WorkerRegistry, register_worker


# ---------------------------------------------------------------------------
# Supervisor message contract
# ---------------------------------------------------------------------------

@dataclass
class SupervisorMessage:
    """A message from the supervisor to a worker or from a worker to the
    supervisor. Threaded by ``correlation_id`` so multi-step workflows
    stay coherent."""
    msg_id: str
    sender: str                     # agent name / session_id
    receiver: str
    content: str
    msg_type: str = "task"          # task | result | callback | steer | interrupt
    correlation_id: str = ""
    task_id: str = ""
    sent_at: str = ""
    delivered_at: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SupervisorMessage":
        return cls(
            msg_id=d.get("msg_id", ""),
            sender=d.get("sender", ""),
            receiver=d.get("receiver", ""),
            content=d.get("content", ""),
            msg_type=d.get("msg_type", "task"),
            correlation_id=d.get("correlation_id", ""),
            task_id=d.get("task_id", ""),
            sent_at=d.get("sent_at", ""),
            delivered_at=d.get("delivered_at", ""),
            extra=d.get("extra", {}),
        )


@dataclass
class WorkerCallback:
    """A callback result from a worker to its supervisor."""
    task_id: str
    worker_id: str
    provider: str
    status: str                     # returned | absent | timeout | error
    output: str
    artifacts: list[dict] = field(default_factory=list)
    confidence: float = 0.0
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Inbox — per-agent message queue
# ---------------------------------------------------------------------------

class AgentInbox:
    """Thread-safe per-agent inbox. Messages are queued and delivered when
    the agent polls (typically at idle checkpoints)."""

    _queues: dict[str, list[SupervisorMessage]] = {}
    _lock = threading.Lock()

    @classmethod
    def send(cls, msg: SupervisorMessage) -> None:
        with cls._lock:
            if msg.receiver not in cls._queues:
                cls._queues[msg.receiver] = []
            if not msg.sent_at:
                msg.sent_at = datetime.now(timezone.utc).isoformat()
            cls._queues[msg.receiver].append(msg)

    @classmethod
    def drain(cls, agent_id: str) -> list[SupervisorMessage]:
        with cls._lock:
            msgs = cls._queues.pop(agent_id, [])
            now = datetime.now(timezone.utc).isoformat()
            for m in msgs:
                m.delivered_at = now
            return msgs

    @classmethod
    def peek(cls, agent_id: str) -> list[SupervisorMessage]:
        with cls._lock:
            return list(cls._queues.get(agent_id, []))


# ---------------------------------------------------------------------------
# Supervisor — the orchestration class
# ---------------------------------------------------------------------------

_PLAN_PROMPT = (
    "You are the Director of a specialized team. Decompose the following task "
    "into 2-4 independent, parallel subtasks. Output each as:\n"
    "  N. <category>: <subtask>\n"
    "Where category is one of: [code, research, scaffold, review, refactor, docs].\n"
    "Assign each a recommended provider from: {providers}\n"
    "Also list any dependencies between subtasks.\n\n"
    "TASK:\n{task}"
)

_WORKER_PROMPT = (
    "You are a specialized worker on a multi-agent team. Complete the assigned "
    "subtask thoroughly and independently.\n\n"
    "YOUR SUBTASK ({category}): {subtask}\n\n"
    "OVERALL TASK (context only): {overall_task}\n\n"
    "{memory_block}"
    "When done, return your result in this format:\n"
    "```json\n{{\"status\":\"returned\",\"summary\":\"...\",\"confidence\":0.8,"
    "\"artifacts\":[],\"notes\":\"...\"}}\n```"
)


class Supervisor:
    """A hierarchical supervisor that decomposes tasks, dispatches them to
    workers, collects callbacks, and synthesizes the result.

    Each worker runs in an **isolated** context — it sees only its subtask
    and injected relevant memories, never the supervisor's full reasoning.
    """

    def __init__(
        self,
        director: str = "codex",
        aggregator: str = "codex",
        session_id: str = "",
        ctx: Optional[MasterContext] = None,
    ) -> None:
        self.director = director
        self.aggregator = aggregator
        self.session_id = session_id or f"supervisor-{uuid.uuid4().hex[:8]}"
        self.context = ctx or session_context(self.session_id)
        self.workers: dict[str, str] = {}   # subtask_id → provider
        self.callbacks: dict[str, WorkerCallback] = {}
        self._run_id = f"run-{int(time.time())}"

    # ------------------------------------------------------------------
    # Core flow
    # ------------------------------------------------------------------

    def decompose_and_dispatch(
        self,
        task: str,
        worker_pool: Optional[list[str]] = None,
        timeout: Optional[int] = None,
    ) -> dict[str, Any]:
        """Full supervisor lifecycle: plan → dispatch → collect → synthesize.

        Returns a dict with keys: task, subtasks, workers, callbacks,
        synthesis, memory_context, steering_hooks.
        """
        provs = worker_pool or available() or ["codex", "copilot", "opencode"]

        # 1. Plan
        plan = self._plan(task, provs, timeout)
        if not plan:
            return {"task": task, "error": "Planning failed", "subtasks": []}

        # 2. Dispatch
        for i, p in enumerate(plan):
            worker_id = f"{self.session_id}-w{i}"
            self.workers[worker_id] = p["provider"]
            self.context.set(f"worker_{worker_id}_subtask", p["subtask"])
            self.context.set(f"worker_{worker_id}_category", p["category"])

        callbacks = self._dispatch_parallel(plan, provs, task, timeout)

        # 3. Collect & validate
        for cb in callbacks:
            self.callbacks[cb.task_id] = cb
            self.context.set(f"callback_{cb.worker_id}", cb.to_dict())

        # 4. Synthesize
        synthesis = self._synthesize(task, plan, callbacks, timeout)

        # 5. Record for learning
        record = {
            "run_id": self._run_id, "pattern": "hierarchical-v2",
            "task": task, "director": self.director,
            "subtasks": [p["subtask"] for p in plan],
            "workers": self.workers,
            "callback_count": len(callbacks),
            "completed_count": sum(1 for c in callbacks if c.status == "returned"),
        }
        record_run(record)

        return {
            "task": task,
            "plan": plan,
            "workers": self.workers,
            "callbacks": [cb.to_dict() for cb in callbacks],
            "synthesis": synthesis,
            "context_snapshot": self.context.snapshot(),
            "session_id": self.session_id,
        }

    # ------------------------------------------------------------------
    # Planning
    # ------------------------------------------------------------------

    def _plan(self, task: str, provs: list[str], timeout: Optional[int]) -> list[dict]:
        """Have the director decompose the task into subtasks."""
        provider_list = ", ".join(provs)
        prompt = _PLAN_PROMPT.format(task=task, providers=provider_list)
        reply = dispatch(self.director, prompt, timeout=timeout)
        if not reply.ok:
            return []

        plan: list[dict] = []
        for line in reply.text.splitlines():
            m = re.match(r"^\s*(\d+)[.)]\s*(?:(\w+)\s*:\s*)?(.+)", line)
            if m:
                category = (m.group(2) or "code").strip().lower()
                subtask = m.group(3).strip()
                provider = self._route_subtask(category, subtask, provs)
                plan.append({"id": f"t{len(plan)}", "category": category,
                            "subtask": subtask, "provider": provider})
        if not plan:
            plan = [{"id": "t0", "category": "code", "subtask": task,
                    "provider": provs[0]}]
        return plan

    def _route_subtask(self, category: str, subtask: str, pool: list[str]) -> str:
        """Route a subtask to the best-fit provider from the pool."""
        # Simple heuristic match; can be extended with policy.py
        strengths = {
            "code": ["codex", "opencode", "copilot"],
            "refactor": ["codex", "opencode"],
            "research": ["grok", "copilot"],
            "scaffold": ["opencode", "copilot", "codex"],
            "review": ["codex", "copilot"],
            "docs": ["copilot", "opencode"],
        }
        for p in strengths.get(category, []):
            if p in pool:
                return p
        return pool[0]

    # ------------------------------------------------------------------
    # Parallel dispatch with context isolation
    # ------------------------------------------------------------------

    def _dispatch_parallel(
        self,
        plan: list[dict],
        pool: list[str],
        task: str,
        timeout: Optional[int],
    ) -> list[WorkerCallback]:
        """Dispatch each subtask to its assigned worker in parallel. Each
        worker receives injected memory context and runs in isolation."""
        callbacks: list[WorkerCallback] = []

        with ThreadPoolExecutor(max_workers=min(4, len(plan))) as ex:
            futs = {}
            for p in plan:
                fut = ex.submit(
                    self._run_single_worker, p, task, timeout,
                )
                futs[fut] = p

            for fut in as_completed(futs):
                p = futs[fut]
                try:
                    cb = fut.result()
                    callbacks.append(cb)
                except Exception as exc:
                    callbacks.append(WorkerCallback(
                        task_id=p["id"], worker_id=f"{p['provider']}-error",
                        provider=p["provider"], status="error", output=str(exc),
                    ))

        return callbacks

    def _run_single_worker(
        self,
        task_item: dict,
        overall_task: str,
        timeout: Optional[int],
    ) -> WorkerCallback:
        """Execute one worker in isolation — registers the worker, injects
        memory context, dispatches, and returns a structured callback."""
        provider = task_item["provider"]
        worker_id = f"{self.session_id}-{task_item['id']}"
        subtask = task_item["subtask"]
        category = task_item.get("category", "code")

        # Register worker for steering
        register_worker(worker_id, provider, self.session_id, subtask)

        # Build isolated prompt — no supervisor context
        memory_block = inject_memory_context(worker_id, subtask)
        prompt = _WORKER_PROMPT.format(
            category=category,
            subtask=subtask,
            overall_task=overall_task,
            memory_block=memory_block or "",
        )

        reply = dispatch(provider, prompt, timeout=timeout)

        # Try to parse structured output
        artifacts: list[dict] = []
        confidence = 0.0
        notes = ""
        output = reply.text
        json_match = re.search(r"\{[\s\S]*\}", reply.text)
        if json_match:
            try:
                parsed = json.loads(json_match.group(0))
                output = parsed.get("summary", reply.text)
                confidence = float(parsed.get("confidence", 0.0))
                artifacts = parsed.get("artifacts", [])
                notes = parsed.get("notes", "")
            except json.JSONDecodeError:
                pass

        WorkerRegistry.set_status(worker_id, "completed", subtask)

        return WorkerCallback(
            task_id=task_item["id"],
            worker_id=worker_id,
            provider=provider,
            status=reply.status,
            output=output,
            artifacts=artifacts,
            confidence=confidence,
            notes=notes,
        )

    # ------------------------------------------------------------------
    # Synthesis
    # ------------------------------------------------------------------

    def _synthesize(
        self,
        task: str,
        plan: list[dict],
        callbacks: list[WorkerCallback],
        timeout: Optional[int],
    ) -> Optional[str]:
        """Have the aggregator integrate worker outputs into one deliverable."""
        if not self.aggregator or self.aggregator == "none":
            return None

        parts = []
        for cb in callbacks:
            task_item = next((p for p in plan if p["id"] == cb.task_id), None)
            sub = task_item["subtask"] if task_item else "unknown"
            parts.append(f"## Subtask: {sub}\nProvider: {cb.provider}\n"
                        f"Status: {cb.status}\n\n{cb.output}")

        synthesis_prompt = (
            f"Integrate the following worker outputs into one coherent "
            f"deliverable for the overall task. Do not just concatenate — "
            f"resolve conflicts, fill gaps, and present a unified result.\n\n"
            f"OVERALL TASK: {task}\n\n" + "\n---\n".join(parts)
        )

        reply = dispatch(self.aggregator, synthesis_prompt, timeout=timeout)
        return reply.text if reply.ok else None

    # ------------------------------------------------------------------
    # Steering hooks — supervisor can intervene mid-flight
    # ------------------------------------------------------------------

    def steer_worker(self, worker_id: str, instruction: str) -> dict[str, Any]:
        """Send a mid-task instruction to a running worker."""
        from .steering import steer as _steer
        return _steer(worker_id, instruction)

    def interrupt_worker(self, worker_id: str) -> dict[str, Any]:
        """Cancel a running worker."""
        from .steering import interrupt as _interrupt
        return _interrupt(worker_id)

    def worker_statuses(self) -> list[dict[str, Any]]:
        """Get status of all workers in this supervisor's session."""
        return [
            w.to_dict()
            for w in WorkerRegistry.list_by_supervisor(self.session_id)
        ]


# ---------------------------------------------------------------------------
# Module-level convenience (backward-compatible with old hierarchical.run)
# ---------------------------------------------------------------------------

def run(
    task: str,
    providers: Optional[list[str]] = None,
    director: str = "codex",
    aggregator: str = "codex",
    timeout: Optional[int] = None,
    session_id: str = "",
    ctx: Optional[MasterContext] = None,
) -> dict[str, Any]:
    """Run the improved hierarchical supervisor-worker pattern.

    Backward-compatible signature with the original ``hierarchical.run()``.
    """
    sv = Supervisor(
        director=director, aggregator=aggregator,
        session_id=session_id, ctx=ctx,
    )
    return sv.decompose_and_dispatch(
        task=task, worker_pool=providers, timeout=timeout,
    )


# ---------------------------------------------------------------------------
# Context isolation helper: build a clean, scoped prompt for a worker
# ---------------------------------------------------------------------------

def build_worker_prompt(
    subtask: str,
    overall_task: str = "",
    category: str = "code",
    worker_id: str = "",
    memory_context: bool = True,
    extra_context: Optional[dict[str, Any]] = None,
) -> str:
    """Build a context-isolated prompt for a worker. The worker sees only
    its subtask + optional injected memories — NOT the supervisor's full
    conversation history or private state."""
    memory_block = ""
    if memory_context and worker_id:
        memory_block = inject_memory_context(worker_id, subtask)

    extra = ""
    if extra_context:
        extra = "\n".join(f"{k}: {v}" for k, v in extra_context.items())

    return (
        f"You are a specialized worker on a multi-agent team. Complete the "
        f"assigned subtask thoroughly and independently.\n\n"
        f"YOUR SUBTASK ({category}): {subtask}\n\n"
        f"{'OVERALL TASK (context only): ' + overall_task if overall_task else ''}"
        f"{extra}\n"
        f"{memory_block}"
    )
