"""Fusion MetaLoop — run-state + dispatch engine (Phase 1, proposal mode).

This module is the deterministic *control plane*. It does NOT try to be the
Chief Operator: planning, adjudication, and integration review belong to the
CO seat — codex (gpt-5.6-sol @ xhigh), DISPATCHED at fixed lifecycle points
when the in-context host is not Codex (see ``skills/fusion-metaloop/SKILL.md``).
The in-context host executes: it applies edits, runs gates, and owns the tree.
What lives here is everything that must be mechanical and auditable:

  - the run-state machine and its legal transitions;
  - dependency-wave computation over a task DAG;
  - correlation-aware model-family counting (the two Gemini harnesses are ONE
    family, never two independent votes);
  - advisor-policy triggers (when a Fable consult is allowed);
  - the bounded escalation ladder (retry -> alternate -> promote -> takeover ->
    advisor -> stop), capped by repair rounds, attempts, calls, and wall time;
  - the run record emitted for the ledger / audit trail.

Offline-first: none of the pure logic here shells out. Worker dispatch is a thin
wrapper over ``adapter.dispatch`` and is only used when the host actually runs a
wave, so the whole module imports and unit-tests with no CLIs installed.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, asdict
from typing import Callable, Optional

from . import adapter
from .adapter import (
    PROVIDER_META, WORKER_PROVIDERS, ADVISOR_PROVIDERS, CORRELATION_GROUPS,
    model_family, same_family, tier_of,
)
from .contracts import TaskSpec, WorkerResult, AdvisorMemo, ContractError
from . import policy
from . import workspaces


# --- run-state machine ------------------------------------------------------

CREATED = "CREATED"
SNAPSHOTTED = "SNAPSHOTTED"
PLANNED_V1 = "PLANNED_V1"
ADVISOR_REVIEWED = "ADVISOR_REVIEWED"
PLANNED_FINAL = "PLANNED_FINAL"
DISPATCHING = "DISPATCHING"
COLLECTING = "COLLECTING"
REPAIRING = "REPAIRING"
INTEGRATING = "INTEGRATING"
FINAL_GATE = "FINAL_GATE"
FINAL_ADVISOR_REVIEW = "FINAL_ADVISOR_REVIEW"
COMPLETED = "COMPLETED"
PARTIAL = "PARTIAL"
BLOCKED = "BLOCKED"
FAILED = "FAILED"
CANCELLED = "CANCELLED"

TERMINAL_STATES = frozenset({COMPLETED, PARTIAL, BLOCKED, FAILED, CANCELLED})

# Legal forward transitions. Optional stages (advisor review, repairing) may be
# skipped; terminal states are reachable from most working states for honest
# early stops (budget exhaustion, blockers).
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    CREATED: {SNAPSHOTTED, CANCELLED},
    SNAPSHOTTED: {PLANNED_V1, CANCELLED, FAILED},
    PLANNED_V1: {ADVISOR_REVIEWED, PLANNED_FINAL, CANCELLED, BLOCKED, FAILED},
    ADVISOR_REVIEWED: {PLANNED_FINAL, BLOCKED, CANCELLED},
    PLANNED_FINAL: {DISPATCHING, CANCELLED, BLOCKED},
    DISPATCHING: {COLLECTING, CANCELLED, FAILED},
    COLLECTING: {REPAIRING, INTEGRATING, PARTIAL, BLOCKED, CANCELLED, FAILED},
    REPAIRING: {COLLECTING, INTEGRATING, PARTIAL, BLOCKED, CANCELLED, FAILED},
    INTEGRATING: {FINAL_GATE, PARTIAL, BLOCKED, CANCELLED, FAILED},
    FINAL_GATE: {FINAL_ADVISOR_REVIEW, COMPLETED, REPAIRING, PARTIAL, BLOCKED, FAILED},
    FINAL_ADVISOR_REVIEW: {COMPLETED, PARTIAL, BLOCKED, FAILED},
}


class StateError(RuntimeError):
    pass


# --- failure taxonomy + escalation actions ----------------------------------

# Failure classes (from the MetaLoop outline §16).
PROVIDER_ABSENT = "provider_absent"
TIMEOUT = "timeout"
RUNTIME_ERROR = "runtime_error"
MALFORMED_OUTPUT = "malformed_output"
SCOPE_VIOLATION = "scope_violation"
VERIFICATION_FAILURE = "verification_failure"
LOW_CONFIDENCE = "low_confidence"
EXPERT_CONFLICT = "expert_conflict"
PLAN_FAILURE = "plan_failure"
BUDGET_EXHAUSTED = "budget_exhausted"
APPROVAL_REQUIRED = "approval_required"
SAFEGUARD_BLOCK = "safeguard_block"

# Escalation actions the ladder can return.
SCHEMA_REPAIR = "schema_repair"          # one retry, same worker, fix the JSON
ALTERNATE_WORKER = "alternate_worker"    # same tier, different provider
PROMOTE = "promote"                      # fast -> expert
HOST_TAKEOVER = "host_takeover"          # GPT does it
HOST_REVIEW = "host_review"              # reject + host decides replan
ADVISOR_CONSULT = "advisor_consult"      # systemic -> Fable
HUMAN_APPROVAL = "human_approval"        # pause for a person
STOP = "stop"                            # bounded-out; synthesize partial


@dataclass
class Action:
    kind: str
    reason: str
    target_tier: str | None = None
    target_provider: str | None = None


# --- config -----------------------------------------------------------------

def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except (ValueError, TypeError):
        return default


@dataclass
class MetaLoopConfig:
    # Fable is the CEO: it frames EVERY run first. Default policy is therefore
    # 'always' (one mandatory CEO preflight), not 'auto'. off | on-demand | auto | always.
    advisor_policy: str = "always"
    max_advisor_calls: int = 2
    max_repair_rounds: int = 2
    max_attempts_per_task: int = 3
    expert_concurrency: int = 2
    fast_concurrency: int = 2
    max_total_external_calls: int = 12
    max_wall_seconds: int = 1800
    workspace_mode: str = workspaces.PROPOSAL
    risk_threshold: int = 2               # plan risk at/above this triggers preflight
    low_confidence: float = 0.5           # below this a worker result is low-confidence
    gate_commands: list[str] = field(default_factory=list)

    @classmethod
    def from_env(cls, **overrides) -> "MetaLoopConfig":
        cfg = cls(
            advisor_policy=os.environ.get("FUSION_META_ADVISOR_POLICY", "always").strip() or "always",
            max_advisor_calls=_env_int("FUSION_META_MAX_ADVISOR_CALLS", 2),
            max_repair_rounds=_env_int("FUSION_META_MAX_REPAIR_ROUNDS", 2),
            max_attempts_per_task=_env_int("FUSION_META_MAX_ATTEMPTS_PER_TASK", 3),
            expert_concurrency=_env_int("FUSION_META_EXPERT_CONCURRENCY", 2),
            fast_concurrency=_env_int("FUSION_META_FAST_CONCURRENCY", 2),
            max_total_external_calls=_env_int("FUSION_META_MAX_CALLS", 12),
            max_wall_seconds=_env_int("FUSION_META_MAX_WALL_SECONDS", 1800),
            workspace_mode=os.environ.get("FUSION_META_WORKSPACE_MODE", workspaces.PROPOSAL).strip()
            or workspaces.PROPOSAL,
        )
        for k, v in overrides.items():
            if v is not None and hasattr(cfg, k):
                setattr(cfg, k, v)
        return cfg


# --- correlation-aware family counting --------------------------------------

def count_model_families(providers: list[str]) -> int:
    """Number of INDEPENDENT model families among providers. Correlated harnesses
    (both Gemini: agy + copilot) collapse to one — they are never two votes."""
    families: set[str] = set()
    for p in providers:
        families.add(model_family(p))
    return len(families)


def is_fake_consensus(providers: list[str]) -> bool:
    """True if a set of >=2 providers is really one family pretending to be a
    multi-family consensus (e.g. agy + copilot)."""
    provs = [p for p in providers if p]
    return len(provs) >= 2 and count_model_families(provs) == 1


# --- dependency waves -------------------------------------------------------

def topological_waves(tasks: list[TaskSpec]) -> list[list[str]]:
    """Group task ids into dependency waves (all tasks in a wave can run in
    parallel). Raises on unknown dependency or dependency cycle."""
    ids = [t.id for t in tasks]
    idset = set(ids)
    if len(idset) != len(ids):
        raise ValueError("duplicate task ids in plan")
    deps = {t.id: set(t.dependencies) for t in tasks}
    for tid, ds in deps.items():
        unknown = ds - idset
        if unknown:
            raise ValueError(f"task '{tid}' depends on unknown task(s): {sorted(unknown)}")

    waves: list[list[str]] = []
    done: set[str] = set()
    remaining = set(ids)
    order = {tid: i for i, tid in enumerate(ids)}
    while remaining:
        ready = sorted((t for t in remaining if deps[t] <= done), key=order.get)
        if not ready:
            raise ValueError(f"dependency cycle among: {sorted(remaining)}")
        waves.append(ready)
        done |= set(ready)
        remaining -= set(ready)
    return waves


# --- advisor policy ---------------------------------------------------------

def advisor_preflight_trigger(tasks: list[TaskSpec], config: MetaLoopConfig,
                              plan_confidence: float | None = None) -> tuple[bool, str]:
    """Decide whether a Fable *preflight* is warranted. Fable is the CEO: under
    the default 'always' policy it frames EVERY run first (before the CO plans),
    and it is still never a per-task worker or a vote — only plan-level judgment.
    'auto' keeps the risk-triggered behaviour for callers that opt into it."""
    if config.advisor_policy == "off":
        return False, "advisor_policy=off"
    if config.max_advisor_calls <= 0:
        return False, "max_advisor_calls=0"
    if config.advisor_policy == "always":
        return True, "advisor_policy=always: Fable (CEO) frames the run first"
    # on-demand never auto-triggers a preflight; auto uses risk signals.
    if config.advisor_policy == "on-demand":
        return False, "advisor_policy=on-demand: host must request explicitly"
    # auto:
    routed = [policy.route(t) for t in tasks]
    if any(r.advisor_preflight for r in routed):
        hit = next(r for r in routed if r.advisor_preflight)
        return True, f"auto: task {hit.task_id} is high-risk host work"
    max_risk = max((t.risk for t in tasks), default=0)
    if max_risk >= config.risk_threshold:
        return True, f"auto: plan max risk {max_risk} >= threshold {config.risk_threshold}"
    if plan_confidence is not None and plan_confidence < 0.6:
        return True, f"auto: plan confidence {plan_confidence} < 0.6"
    return False, "auto: no high-risk / low-confidence trigger"


# --- run object -------------------------------------------------------------

@dataclass
class RunCounters:
    advisor_calls: int = 0
    repair_rounds: int = 0
    external_calls: int = 0
    attempts: dict = field(default_factory=dict)   # task_id -> int


class MetaLoopRun:
    """Holds run state, an append-only event log, budget counters, and accepted
    results. The host mutates this as it drives the SKILL; the engine enforces
    the mechanical invariants (legal transitions, budgets, attempt caps)."""

    def __init__(self, run_id: str, config: MetaLoopConfig, *, now: float = 0.0):
        self.run_id = run_id
        self.config = config
        self.state = CREATED
        self.started_at = now
        self.events: list[dict] = []
        self.counters = RunCounters()
        self.accepted: dict[str, WorkerResult] = {}
        self.advisor_memos: list[AdvisorMemo] = []
        self.status = "running"
        self.record_event("run_created", run_id=run_id)

    # -- events -------------------------------------------------------------
    def record_event(self, event_type: str, **fields) -> dict:
        ev = {"run_id": self.run_id, "event_type": event_type, "state": self.state, **fields}
        self.events.append(ev)
        return ev

    # -- state machine ------------------------------------------------------
    def transition(self, new_state: str) -> None:
        if self.state in TERMINAL_STATES:
            raise StateError(f"run is terminal ({self.state}); cannot move to {new_state}")
        allowed = ALLOWED_TRANSITIONS.get(self.state, set())
        if new_state not in allowed:
            raise StateError(f"illegal transition {self.state} -> {new_state}")
        self.record_event("transition", to=new_state, frm=self.state)
        self.state = new_state
        if new_state in TERMINAL_STATES:
            self.status = new_state.lower()

    # -- budgets ------------------------------------------------------------
    def budget_exceeded(self, now: float | None = None) -> tuple[bool, str]:
        c, cfg = self.counters, self.config
        if c.external_calls >= cfg.max_total_external_calls:
            return True, f"external calls {c.external_calls} >= {cfg.max_total_external_calls}"
        if c.repair_rounds >= cfg.max_repair_rounds:
            return True, f"repair rounds {c.repair_rounds} >= {cfg.max_repair_rounds}"
        if now is not None and (now - self.started_at) >= cfg.max_wall_seconds:
            return True, f"wall {now - self.started_at:.0f}s >= {cfg.max_wall_seconds}s"
        return False, ""

    def note_external_call(self) -> None:
        self.counters.external_calls += 1

    def note_repair_round(self) -> None:
        self.counters.repair_rounds += 1

    def note_attempt(self, task_id: str) -> int:
        self.counters.attempts[task_id] = self.counters.attempts.get(task_id, 0) + 1
        return self.counters.attempts[task_id]

    def attempts_for(self, task_id: str) -> int:
        return self.counters.attempts.get(task_id, 0)

    def note_advisor_call(self) -> bool:
        """Register a Fable consult; returns False (and does not increment) if the
        advisor budget is already spent."""
        if self.counters.advisor_calls >= self.config.max_advisor_calls:
            return False
        self.counters.advisor_calls += 1
        return True

    # -- results ------------------------------------------------------------
    def accept(self, result: WorkerResult) -> None:
        result.check()
        self.accepted[result.task_id] = result
        self.record_event("task_accepted", task_id=result.task_id,
                           provider=result.provider, model=result.model,
                           model_family=result.model_family, harness=result.harness,
                           attempt=result.attempt, confidence=result.confidence)

    # -- audit --------------------------------------------------------------
    def to_run_record(self) -> dict:
        """Ledger/audit record. Correlation groups and per-family counts are
        surfaced so a reviewer can see that correlated harnesses were not double
        counted."""
        panelists = [
            {"provider": r.provider, "model": r.model, "model_family": r.model_family,
             "harness": r.harness, "tier": tier_of(r.provider), "status": r.status,
             "task": tid}
            for tid, r in self.accepted.items()
        ]
        return {
            "run_id": self.run_id,
            "task_type": "metaloop",
            "mode": "metaloop",
            "status": self.status,
            "state": self.state,
            "advisor_calls": self.counters.advisor_calls,
            "repair_rounds": self.counters.repair_rounds,
            "external_calls": self.counters.external_calls,
            "workspace_mode": self.config.workspace_mode,
            "correlation_groups": CORRELATION_GROUPS,
            "distinct_model_families": count_model_families([p["provider"] for p in panelists]),
            "panelists": panelists,
            "absent_is_agreement": False,
        }


# --- escalation ladder ------------------------------------------------------

def classify_worker_reply(reply: adapter.Reply) -> str | None:
    """Map an adapter Reply status to a MetaLoop failure class, or None if the
    reply is a usable return (further contract validation happens separately)."""
    if reply.status == "returned" and reply.text.strip():
        return None
    return {
        "absent": PROVIDER_ABSENT,
        "timeout": TIMEOUT,
        "error": RUNTIME_ERROR,
    }.get(reply.status, RUNTIME_ERROR)


def next_action(failure: str, task: TaskSpec, run: MetaLoopRun,
                *, now: float | None = None) -> Action:
    """The bounded escalation decision. Budgets and attempt caps are checked
    FIRST so the ladder can never spin: once the caps are hit the only move is
    STOP (synthesize partial) or HUMAN_APPROVAL (pause)."""
    if failure == APPROVAL_REQUIRED:
        return Action(HUMAN_APPROVAL, "task requires human approval before acting")

    over, why = run.budget_exceeded(now=now)
    if over:
        return Action(STOP, f"budget exhausted: {why}")

    attempts = run.attempts_for(task.id)
    if attempts >= run.config.max_attempts_per_task:
        return Action(STOP, f"attempts {attempts} >= cap {run.config.max_attempts_per_task}")

    current_tier = policy.route(task).tier

    if failure == MALFORMED_OUTPUT:
        # exactly one schema-repair retry, then treat as a real failure next round
        if attempts <= 1:
            return Action(SCHEMA_REPAIR, "one schema-repair retry", target_tier=current_tier)
        failure = VERIFICATION_FAILURE  # escalate past a stubborn malformed worker

    if failure in (TIMEOUT, RUNTIME_ERROR, PROVIDER_ABSENT):
        return Action(ALTERNATE_WORKER, f"{failure}: try alternate worker in same tier",
                      target_tier=current_tier)

    if failure == SCOPE_VIOLATION:
        return Action(HOST_REVIEW, "changed a forbidden/unapproved path: host decides replan")

    if failure in (VERIFICATION_FAILURE, LOW_CONFIDENCE):
        if current_tier == "fast":
            return Action(PROMOTE, "fast failure/low-confidence: promote to expert tier",
                          target_tier="expert")
        return Action(HOST_TAKEOVER, "expert failure on checkable work: host takes over")

    if failure == EXPERT_CONFLICT:
        return Action(HOST_TAKEOVER, "experts disagree materially: host adjudicates")

    if failure == PLAN_FAILURE:
        if run.counters.advisor_calls < run.config.max_advisor_calls:
            return Action(ADVISOR_CONSULT, "systemic plan failure: consult Fable")
        return Action(STOP, "systemic failure with advisor budget spent: stop honestly")

    if failure == SAFEGUARD_BLOCK:
        return Action(HOST_TAKEOVER, "advisor safeguard/fallback: host continues in careful mode")

    return Action(STOP, f"unhandled failure '{failure}': stop and report")


# --- worker dispatch (thin wrapper over verified adapters) ------------------

def build_worker_prompt(task: TaskSpec, capsule: str, *, tier: str) -> str:
    """Assemble the worker instruction packet: role, exact TaskSpec, capsule,
    the output contract, and the anti-scope-expansion prohibition. Kept pure so
    it is unit-testable and identical across providers."""
    role = ("expert worker" if tier == "expert"
            else "fast execution worker" if tier == "fast" else f"{tier} worker")
    return (
        f"You are a {role} in a centrally orchestrated Fusion MetaLoop run.\n"
        f"Complete EXACTLY this TaskSpec. Do not rewrite the plan or widen scope.\n\n"
        f"TASK_SPEC (JSON):\n{json.dumps(task.to_dict(), ensure_ascii=False, indent=2)}\n\n"
        f"CONTEXT CAPSULE:\n{capsule}\n\n"
        "RULES:\n"
        "- Use only the allowed_paths. Never touch a forbidden_path.\n"
        "- Produce the required artifact and run the verification_cmd if given.\n"
        "- Return ONLY one JSON object matching WorkerResult, with EXACTLY these shapes "
        "(no prose, no markdown fence around it):\n"
        "    status: one of \"returned\"|\"blocked\"|\"error\" (use \"returned\" on success),\n"
        "    summary: string, artifacts: array of objects, evidence: array of strings,\n"
        "    checks_run: array of objects, confidence: number 0..1, blockers: array of strings,\n"
        "    scope_expansion_needed: boolean.\n"
        "- If the contract is impossible or unsafe, set status=\"blocked\" and list blockers; "
        "do not improvise.\n"
    )


# Common worker-reply status synonyms models emit instead of the exact enum.
_WORKER_STATUS_SYNONYMS = {
    "success": "returned", "succeeded": "returned", "ok": "returned",
    "done": "returned", "complete": "returned", "completed": "returned",
    "pass": "returned", "passed": "returned", "failed": "error", "failure": "error",
    "blocker": "blocked", "stuck": "blocked",
}


def _coerce_worker_obj(obj: dict) -> dict:
    """Normalize the common, UNAMBIGUOUS shape drifts a model makes when emitting
    a WorkerResult, so a grounded reply is not rejected over cosmetics. Semantic
    fields are never fabricated — only reshaped (dict->list, status synonym,
    stringify). Anything genuinely wrong still fails closed in ``check()``."""
    if not isinstance(obj, dict):
        return obj
    st = obj.get("status")
    if isinstance(st, str):
        obj["status"] = _WORKER_STATUS_SYNONYMS.get(st.strip().lower(), st)
    # artifacts: object -> [object]; drop empty {}
    a = obj.get("artifacts")
    if isinstance(a, dict):
        obj["artifacts"] = [a] if a else []
    # evidence: dict -> ["k: v", ...]; list items stringified
    ev = obj.get("evidence")
    if isinstance(ev, dict):
        obj["evidence"] = [f"{k}: {v}" for k, v in ev.items()]
    elif isinstance(ev, list):
        obj["evidence"] = [x if isinstance(x, str) else json.dumps(x, ensure_ascii=False) for x in ev]
    elif isinstance(ev, str):
        obj["evidence"] = [ev]
    # checks_run: strings -> {"note": s}; object -> [object]
    cr = obj.get("checks_run")
    if isinstance(cr, dict):
        obj["checks_run"] = [cr]
    elif isinstance(cr, list):
        obj["checks_run"] = [c if isinstance(c, dict) else {"note": str(c)} for c in cr]
    # blockers: string -> [string]
    bl = obj.get("blockers")
    if isinstance(bl, str):
        obj["blockers"] = [bl]
    return obj


def parse_worker_result(text: str, *, task_id: str, provider: str, attempt: int) -> WorkerResult:
    """Parse a worker's JSON reply into a validated WorkerResult. Tolerant of a
    ```json fence and of the common shape drifts (see ``_coerce_worker_obj``);
    strict about semantics. Raises ContractError on bad shape so the caller can
    trigger a bounded schema-repair."""
    raw = text.strip()
    if raw.startswith("```"):
        raw = raw.split("```", 2)[1] if raw.count("```") >= 2 else raw.strip("`")
        raw = raw[len("json"):].strip() if raw.lower().startswith("json") else raw
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ContractError("WorkerResult", ["no JSON object found in worker reply"])
    try:
        obj = json.loads(raw[start:end + 1])
    except json.JSONDecodeError as ex:
        raise ContractError("WorkerResult", [f"invalid JSON: {ex}"]) from ex
    if not isinstance(obj, dict):
        raise ContractError("WorkerResult", ["worker reply is not a JSON object"])
    obj = _coerce_worker_obj(obj)
    # The dispatching engine is the source of truth for provenance — overwrite any
    # provider/model/family/harness the worker guessed (agy often self-reports
    # "google" / "Fusion MetaLoop"); keep everything else the model produced.
    meta = PROVIDER_META.get(provider, {})
    obj["task_id"] = obj.get("task_id") or task_id
    obj["provider"] = provider
    obj["model"] = meta.get("model", "") or obj.get("model", "")
    obj["model_family"] = meta.get("model_family", "") or obj.get("model_family", "")
    obj["harness"] = meta.get("harness", "") or obj.get("harness", "")
    obj.setdefault("attempt", attempt)
    return WorkerResult.from_dict(obj).check()


def dispatch_worker_task(task: TaskSpec, provider: str, capsule: str, *,
                         attempt: int, timeout: Optional[int] = None,
                         repo: str = "", dispatch_fn: Callable | None = None,
                         ) -> tuple[Optional[WorkerResult], str]:
    """Run one worker task via its verified adapter. Returns (result_or_None,
    failure_class_or_''). ``repo`` is the repo dir the worker snapshots for READ
    context (proposal mode). ``dispatch_fn`` is injectable for tests."""
    tier = tier_of(provider)
    prompt = build_worker_prompt(task, capsule, tier=tier)
    dfn = dispatch_fn or adapter.dispatch
    meta = PROVIDER_META.get(provider, {})
    reply = dfn(provider, prompt, model=meta.get("model", ""), timeout=timeout, repo=repo)
    fclass = classify_worker_reply(reply)
    if fclass:
        return None, fclass
    try:
        return parse_worker_result(reply.text, task_id=task.id, provider=provider, attempt=attempt), ""
    except ContractError:
        return None, MALFORMED_OUTPUT


# --- live worker-wave driver ------------------------------------------------

def dispatch_worker_wave(assignments: list[tuple[TaskSpec, str, str]], *,
                         repo: str = "", timeout: Optional[int] = None,
                         max_workers: int = 4,
                         dispatch_fn: Callable | None = None) -> list[dict]:
    """Dispatch a whole wave of (task, provider, capsule) assignments CONCURRENTLY
    against the real repo (proposal mode: each worker snapshots ``repo`` for READ,
    writes only its disposable copy). Returns one dict per assignment:
    ``{task_id, provider, tier, result, failure}`` where ``result`` is a validated
    WorkerResult or None and ``failure`` is '' or a failure-class string.

    This is the deterministic control-plane driver for a labor wave; the Chief
    Operator's planning/integration stays host-native in the skill. A blank /
    timed-out / malformed worker is reported absent — never merged as agreement.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def _one(idx: int, task: TaskSpec, provider: str, capsule: str) -> dict:
        res, fail = dispatch_worker_task(
            task, provider, capsule, attempt=1, timeout=timeout,
            repo=repo, dispatch_fn=dispatch_fn,
        )
        return {
            "index": idx, "task_id": task.id, "provider": provider,
            "tier": tier_of(provider), "result": res, "failure": fail,
        }

    out: list[dict] = []
    if not assignments:
        return out
    with ThreadPoolExecutor(max_workers=max(1, min(max_workers, len(assignments)))) as ex:
        futs = [ex.submit(_one, i, t, p, c) for i, (t, p, c) in enumerate(assignments)]
        for f in as_completed(futs):
            out.append(f.result())
    out.sort(key=lambda r: r["index"])
    return out


# --- lightweight orchestration helper (host-native drive lives in the skill) -

def new_run(task_summary: str, config: MetaLoopConfig | None = None, *,
            run_id: str = "ml_run", now: float = 0.0) -> MetaLoopRun:
    cfg = config or MetaLoopConfig.from_env()
    run = MetaLoopRun(run_id, cfg, now=now)
    run.record_event("intake", summary=task_summary[:400])
    return run


__all__ = [
    # states
    "CREATED", "SNAPSHOTTED", "PLANNED_V1", "ADVISOR_REVIEWED", "PLANNED_FINAL",
    "DISPATCHING", "COLLECTING", "REPAIRING", "INTEGRATING", "FINAL_GATE",
    "FINAL_ADVISOR_REVIEW", "COMPLETED", "PARTIAL", "BLOCKED", "FAILED", "CANCELLED",
    "TERMINAL_STATES", "ALLOWED_TRANSITIONS", "StateError",
    # failure + actions
    "PROVIDER_ABSENT", "TIMEOUT", "RUNTIME_ERROR", "MALFORMED_OUTPUT", "SCOPE_VIOLATION",
    "VERIFICATION_FAILURE", "LOW_CONFIDENCE", "EXPERT_CONFLICT", "PLAN_FAILURE",
    "BUDGET_EXHAUSTED", "APPROVAL_REQUIRED", "SAFEGUARD_BLOCK",
    "SCHEMA_REPAIR", "ALTERNATE_WORKER", "PROMOTE", "HOST_TAKEOVER", "HOST_REVIEW",
    "ADVISOR_CONSULT", "HUMAN_APPROVAL", "STOP", "Action", "next_action",
    "classify_worker_reply",
    # config + run
    "MetaLoopConfig", "MetaLoopRun", "RunCounters", "new_run",
    # pure helpers
    "count_model_families", "is_fake_consensus", "topological_waves",
    "advisor_preflight_trigger", "build_worker_prompt", "parse_worker_result",
    "dispatch_worker_task", "dispatch_worker_wave",
]
