"""Fusion MetaLoop — typed contracts (stdlib only, no jsonschema dependency).

Every handoff in MetaLoop is a *typed, validated* object rather than free text:

  - TaskSpec    — a delegated unit of work (objective, risk profile, allowed
                  paths, acceptance criteria, routing hints).
  - WorkerResult — what a worker (expert/fast/host) returns for one task.
  - AdvisorMemo  — the Board Advisor (Fable) structured critique.
  - GateResult   — the outcome of a deterministic verification gate.

The mirror JSON Schema lives at ``docs/metaloop.schema.json``. This module
re-implements the same constraints in pure Python so validation works with no
pip installs (Fusion is deliberately stdlib-only). Validation *fails closed*:
unknown enum values, out-of-range integers, and missing required fields are
errors, never silently coerced — that is what stops a malformed worker reply
from being merged as if it were valid evidence.

Design invariants enforced here (from the MetaLoop outline):
  - dimensional scores are integers in 0..3;
  - a worker ``status`` outside the taxonomy is rejected;
  - an advisor ``decision`` must be exactly approve|revise|stop;
  - ``preferred_tier`` must be one of host|advisor|expert|fast.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


# --- enumerations (fail-closed value sets) ----------------------------------

TIERS = ("host", "operator", "advisor", "expert", "fast")
APPROVAL_LEVELS = ("none", "human_before_execute", "human_before_integrate")
WORKER_STATUSES = ("returned", "absent", "timeout", "error", "blocked", "fallback")
ADVISOR_DECISIONS = ("approve", "revise", "stop")
GATE_STATUSES = ("pass", "fail", "blocked", "skipped")

# Score dimensions constrained to 0..3.
_SCORE_FIELDS = (
    "complexity", "risk", "novelty", "ambiguity",
    "latency_priority", "context_size", "blast_radius",
)


class ContractError(ValueError):
    """Raised when an object fails schema validation. ``errors`` lists every
    problem found (validation collects all issues, it does not stop at the
    first) so a schema-repair prompt can address them together."""

    def __init__(self, kind: str, errors: list[str]):
        self.kind = kind
        self.errors = errors
        super().__init__(f"{kind}: " + "; ".join(errors))


# --- helpers ----------------------------------------------------------------

def _err(errors: list[str], cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


def _is_int_0_3(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and 0 <= v <= 3


def _is_str_list(v: Any) -> bool:
    return isinstance(v, list) and all(isinstance(x, str) for x in v)


# --- TaskSpec ---------------------------------------------------------------

@dataclass
class TaskSpec:
    id: str
    objective: str
    category: str
    complexity: int = 0
    risk: int = 0
    novelty: int = 0
    ambiguity: int = 0
    latency_priority: int = 0
    context_size: int = 0
    blast_radius: int = 0
    tool_needs: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    allowed_paths: list[str] = field(default_factory=list)
    forbidden_paths: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    verification_cmd: str | None = None
    preferred_tier: str = "fast"
    preferred_provider: str | None = None
    fallback_chain: list[str] = field(default_factory=list)
    artifact_contract: dict = field(default_factory=dict)
    approval_level: str = "none"

    def validate(self) -> list[str]:
        e: list[str] = []
        _err(e, isinstance(self.id, str) and self.id.strip() != "", "id must be a non-empty string")
        _err(e, isinstance(self.objective, str) and self.objective.strip() != "",
             "objective must be a non-empty string")
        _err(e, isinstance(self.category, str) and self.category.strip() != "",
             "category must be a non-empty string")
        for fld in _SCORE_FIELDS:
            _err(e, _is_int_0_3(getattr(self, fld)), f"{fld} must be an integer in 0..3")
        for fld in ("tool_needs", "dependencies", "allowed_paths",
                    "forbidden_paths", "acceptance_criteria", "fallback_chain"):
            _err(e, _is_str_list(getattr(self, fld)), f"{fld} must be a list of strings")
        _err(e, isinstance(self.acceptance_criteria, list) and len(self.acceptance_criteria) >= 1,
             "acceptance_criteria must have at least one entry")
        _err(e, self.verification_cmd is None or isinstance(self.verification_cmd, str),
             "verification_cmd must be a string or null")
        _err(e, self.preferred_tier in TIERS, f"preferred_tier must be one of {TIERS}")
        _err(e, self.preferred_provider is None or isinstance(self.preferred_provider, str),
             "preferred_provider must be a string or null")
        _err(e, isinstance(self.artifact_contract, dict), "artifact_contract must be an object")
        _err(e, self.approval_level in APPROVAL_LEVELS,
             f"approval_level must be one of {APPROVAL_LEVELS}")
        return e

    def check(self) -> "TaskSpec":
        e = self.validate()
        if e:
            raise ContractError("TaskSpec", e)
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TaskSpec":
        if not isinstance(d, dict):
            raise ContractError("TaskSpec", ["input is not an object"])
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        unknown = set(d) - known
        if unknown:
            raise ContractError("TaskSpec", [f"unknown field(s): {sorted(unknown)}"])
        return cls(**d)


# --- WorkerResult -----------------------------------------------------------

@dataclass
class WorkerResult:
    task_id: str
    provider: str
    model: str
    model_family: str
    harness: str
    attempt: int
    status: str
    summary: str
    artifacts: list[dict] = field(default_factory=list)
    patch: str | None = None
    evidence: list[str] = field(default_factory=list)
    checks_run: list[dict] = field(default_factory=list)
    confidence: float = 0.0
    blockers: list[str] = field(default_factory=list)
    scope_expansion_needed: bool = False
    notes_for_integrator: list[str] = field(default_factory=list)

    def validate(self) -> list[str]:
        e: list[str] = []
        for fld in ("task_id", "provider", "model", "model_family", "harness", "summary"):
            _err(e, isinstance(getattr(self, fld), str), f"{fld} must be a string")
        _err(e, isinstance(self.attempt, int) and not isinstance(self.attempt, bool) and self.attempt >= 1,
             "attempt must be an integer >= 1")
        _err(e, self.status in WORKER_STATUSES, f"status must be one of {WORKER_STATUSES}")
        _err(e, isinstance(self.artifacts, list) and all(isinstance(x, dict) for x in self.artifacts),
             "artifacts must be a list of objects")
        _err(e, self.patch is None or isinstance(self.patch, str), "patch must be a string or null")
        _err(e, _is_str_list(self.evidence), "evidence must be a list of strings")
        _err(e, isinstance(self.checks_run, list) and all(isinstance(x, dict) for x in self.checks_run),
             "checks_run must be a list of objects")
        _err(e, isinstance(self.confidence, (int, float)) and not isinstance(self.confidence, bool)
             and 0.0 <= float(self.confidence) <= 1.0, "confidence must be a number in 0..1")
        _err(e, _is_str_list(self.blockers), "blockers must be a list of strings")
        _err(e, isinstance(self.scope_expansion_needed, bool), "scope_expansion_needed must be a boolean")
        _err(e, _is_str_list(self.notes_for_integrator), "notes_for_integrator must be a list of strings")
        return e

    def check(self) -> "WorkerResult":
        e = self.validate()
        if e:
            raise ContractError("WorkerResult", e)
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "WorkerResult":
        if not isinstance(d, dict):
            raise ContractError("WorkerResult", ["input is not an object"])
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        unknown = set(d) - known
        if unknown:
            raise ContractError("WorkerResult", [f"unknown field(s): {sorted(unknown)}"])
        return cls(**d)


# --- AdvisorMemo ------------------------------------------------------------

@dataclass
class AdvisorMemo:
    decision: str
    plan_version: int
    consult_reason: str
    risk_findings: list[dict] = field(default_factory=list)
    decomposition_findings: list[str] = field(default_factory=list)
    missing_evidence: list[str] = field(default_factory=list)
    required_changes: list[str] = field(default_factory=list)
    optional_taste_notes: list[str] = field(default_factory=list)
    confidence: float = 0.0

    def validate(self) -> list[str]:
        e: list[str] = []
        _err(e, self.decision in ADVISOR_DECISIONS, f"decision must be one of {ADVISOR_DECISIONS}")
        _err(e, isinstance(self.plan_version, int) and not isinstance(self.plan_version, bool)
             and self.plan_version >= 1, "plan_version must be an integer >= 1")
        _err(e, isinstance(self.consult_reason, str), "consult_reason must be a string")
        _err(e, isinstance(self.risk_findings, list) and all(isinstance(x, dict) for x in self.risk_findings),
             "risk_findings must be a list of objects")
        for fld in ("decomposition_findings", "missing_evidence",
                    "required_changes", "optional_taste_notes"):
            _err(e, _is_str_list(getattr(self, fld)), f"{fld} must be a list of strings")
        _err(e, isinstance(self.confidence, (int, float)) and not isinstance(self.confidence, bool)
             and 0.0 <= float(self.confidence) <= 1.0, "confidence must be a number in 0..1")
        return e

    def check(self) -> "AdvisorMemo":
        e = self.validate()
        if e:
            raise ContractError("AdvisorMemo", e)
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "AdvisorMemo":
        if not isinstance(d, dict):
            raise ContractError("AdvisorMemo", ["input is not an object"])
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        unknown = set(d) - known
        if unknown:
            raise ContractError("AdvisorMemo", [f"unknown field(s): {sorted(unknown)}"])
        d = dict(d)
        # Tolerant ingestion: models often emit risk_findings as bare strings.
        # Normalize each to {"finding": <str>} so the internal shape stays objects
        # without forcing a schema-repair round over a cosmetic difference.
        rf = d.get("risk_findings")
        if isinstance(rf, list):
            d["risk_findings"] = [
                {"finding": x} if isinstance(x, str) else x for x in rf
            ]
        return cls(**d)


# --- GateResult -------------------------------------------------------------

@dataclass
class GateResult:
    gate_id: str
    run_id: str
    status: str
    commands: list[dict] = field(default_factory=list)
    acceptance_checks: list[dict] = field(default_factory=list)
    changed_paths: list[str] = field(default_factory=list)
    violations: list[str] = field(default_factory=list)
    verified_at: str | None = None

    def validate(self) -> list[str]:
        e: list[str] = []
        for fld in ("gate_id", "run_id"):
            _err(e, isinstance(getattr(self, fld), str), f"{fld} must be a string")
        _err(e, self.status in GATE_STATUSES, f"status must be one of {GATE_STATUSES}")
        _err(e, isinstance(self.commands, list) and all(isinstance(x, dict) for x in self.commands),
             "commands must be a list of objects")
        _err(e, isinstance(self.acceptance_checks, list)
             and all(isinstance(x, dict) for x in self.acceptance_checks),
             "acceptance_checks must be a list of objects")
        _err(e, _is_str_list(self.changed_paths), "changed_paths must be a list of strings")
        _err(e, _is_str_list(self.violations), "violations must be a list of strings")
        _err(e, self.verified_at is None or isinstance(self.verified_at, str),
             "verified_at must be a string or null")
        return e

    def check(self) -> "GateResult":
        e = self.validate()
        if e:
            raise ContractError("GateResult", e)
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "GateResult":
        if not isinstance(d, dict):
            raise ContractError("GateResult", ["input is not an object"])
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        unknown = set(d) - known
        if unknown:
            raise ContractError("GateResult", [f"unknown field(s): {sorted(unknown)}"])
        return cls(**d)


# --- ContextSnapshot — agency context serialisation ---------------------------------------

@dataclass
class ContextSnapshot:
    """A serialisable snapshot of the agency context at a point in time.
    Used to persist state across tool calls or to hand off context between
    agents in a JSON-safe format."""
    session_id: str
    keys: list[str] = field(default_factory=list)
    values: dict[str, Any] = field(default_factory=dict)
    captured_at: str = ""
    agent_name: str = ""

    def validate(self) -> list[str]:
        e: list[str] = []
        _err(e, isinstance(self.session_id, str) and self.session_id.strip() != "",
             "session_id must be a non-empty string")
        _err(e, isinstance(self.keys, list) and all(isinstance(k, str) for k in self.keys),
             "keys must be a list of strings")
        _err(e, isinstance(self.values, dict), "values must be an object")
        return e

    def check(self) -> "ContextSnapshot":
        e = self.validate()
        if e:
            raise ContractError("ContextSnapshot", e)
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ContextSnapshot":
        if not isinstance(d, dict):
            raise ContractError("ContextSnapshot", ["input is not an object"])
        return cls(
            session_id=d.get("session_id", ""),
            keys=d.get("keys", []),
            values=d.get("values", {}),
            captured_at=d.get("captured_at", ""),
            agent_name=d.get("agent_name", ""),
        )


# --- MemoryRecord — serialisable memory entry ---------------------------------------------

MEMORY_SCOPES = ("global", "project", "session", "agent", "federated")
MEMORY_TYPES = ("project", "user", "feedback", "reference")

@dataclass
class MemoryRecord:
    """A single persisted memory entry. Mirrors ``memory_service.MemoryEntry``
    but as a typed contract for serialisation across process boundaries."""
    key: str
    content: str
    scope: str = "project"
    scope_id: str = ""
    memory_type: str = "feedback"
    tags: list[str] = field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""
    usage_count: int = 0
    related: list[str] = field(default_factory=list)

    def validate(self) -> list[str]:
        e: list[str] = []
        _err(e, isinstance(self.key, str) and self.key.strip() != "",
             "key must be a non-empty string")
        _err(e, isinstance(self.content, str) and self.content.strip() != "",
             "content must be a non-empty string")
        _err(e, self.scope in MEMORY_SCOPES, f"scope must be one of {MEMORY_SCOPES}")
        _err(e, self.memory_type in MEMORY_TYPES, f"memory_type must be one of {MEMORY_TYPES}")
        _err(e, _is_str_list(self.tags), "tags must be a list of strings")
        _err(e, _is_str_list(self.related), "related must be a list of strings")
        _err(e, isinstance(self.usage_count, int) and not isinstance(self.usage_count, bool),
             "usage_count must be an integer")
        return e

    def check(self) -> "MemoryRecord":
        e = self.validate()
        if e:
            raise ContractError("MemoryRecord", e)
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "MemoryRecord":
        if not isinstance(d, dict):
            raise ContractError("MemoryRecord", ["input is not an object"])
        return cls(
            key=d.get("key", ""), content=d.get("content", ""),
            scope=d.get("scope", "project"), scope_id=d.get("scope_id", ""),
            memory_type=d.get("memory_type", "feedback"),
            tags=d.get("tags", []), created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""), usage_count=d.get("usage_count", 0),
            related=d.get("related", []),
        )


# --- SteeringAction — worker steering request ---------------------------------------------

STEERING_ACTIONS = ("attach", "interrupt", "steer", "status")

@dataclass
class SteeringAction:
    """A steering command issued by a supervisor to a running worker."""
    action: str
    worker_id: str
    supervisor_id: str = ""
    instruction: str = ""             # for "steer" actions
    timeout_seconds: int = 5          # for "interrupt" actions
    issued_at: str = ""

    def validate(self) -> list[str]:
        e: list[str] = []
        _err(e, self.action in STEERING_ACTIONS, f"action must be one of {STEERING_ACTIONS}")
        _err(e, isinstance(self.worker_id, str) and self.worker_id.strip() != "",
             "worker_id must be a non-empty string")
        _err(e, isinstance(self.supervisor_id, str), "supervisor_id must be a string")
        _err(e, isinstance(self.timeout_seconds, int) and not isinstance(self.timeout_seconds, bool)
             and self.timeout_seconds >= 0, "timeout_seconds must be a non-negative integer")
        return e

    def check(self) -> "SteeringAction":
        e = self.validate()
        if e:
            raise ContractError("SteeringAction", e)
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "SteeringAction":
        if not isinstance(d, dict):
            raise ContractError("SteeringAction", ["input is not an object"])
        return cls(
            action=d.get("action", ""), worker_id=d.get("worker_id", ""),
            supervisor_id=d.get("supervisor_id", ""),
            instruction=d.get("instruction", ""),
            timeout_seconds=d.get("timeout_seconds", 5),
            issued_at=d.get("issued_at", ""),
        )


# --- SteeringResult — outcome of a steering action ----------------------------------------

@dataclass
class SteeringResult:
    """Result returned after executing a SteeringAction."""
    action: str
    worker_id: str
    success: bool
    message: str
    worker_output: str = ""
    worker_status: str = ""
    timestamp: str = ""

    def validate(self) -> list[str]:
        e: list[str] = []
        _err(e, self.action in STEERING_ACTIONS, f"action must be one of {STEERING_ACTIONS}")
        _err(e, isinstance(self.worker_id, str) and self.worker_id.strip() != "",
             "worker_id must be a non-empty string")
        _err(e, isinstance(self.success, bool), "success must be a boolean")
        _err(e, isinstance(self.message, str), "message must be a string")
        return e

    def check(self) -> "SteeringResult":
        e = self.validate()
        if e:
            raise ContractError("SteeringResult", e)
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "SteeringResult":
        if not isinstance(d, dict):
            raise ContractError("SteeringResult", ["input is not an object"])
        return cls(
            action=d.get("action", ""), worker_id=d.get("worker_id", ""),
            success=d.get("success", False), message=d.get("message", ""),
            worker_output=d.get("worker_output", ""),
            worker_status=d.get("worker_status", ""),
            timestamp=d.get("timestamp", ""),
        )


__all__ = [
    "TIERS", "APPROVAL_LEVELS", "WORKER_STATUSES", "ADVISOR_DECISIONS", "GATE_STATUSES",
    "MEMORY_SCOPES", "MEMORY_TYPES", "STEERING_ACTIONS",
    "ContractError", "TaskSpec", "WorkerResult", "AdvisorMemo", "GateResult",
    "ContextSnapshot", "MemoryRecord", "SteeringAction", "SteeringResult",
]
