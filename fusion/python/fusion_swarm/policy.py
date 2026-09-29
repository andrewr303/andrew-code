"""Fusion MetaLoop — routing policy.

Turns a validated :class:`~fusion_swarm.contracts.TaskSpec` into a transparent,
auditable routing decision. The rule order is deliberate and non-negotiable:

  1. HARD OVERRIDES win first. Security, auth, data migrations, money/legal,
     public contracts, cross-cutting architecture, production config, merge
     conflicts, and final integration are kept by the GPT Chief Operator (host)
     regardless of any learned provider preference. Destructive / production /
     paid-large work additionally raises an approval flag for a human gate.
  2. Otherwise a single, explainable heuristic score decides expert vs fast:

         expert_pressure =
             2*risk + 2*complexity + context_size + novelty + ambiguity
             + blast_radius - latency_priority - verification_strength

     expert_pressure >= 8            -> expert lane
     expert_pressure <= 3 & risk<=1  -> fast lane
     otherwise                       -> host chooses (provider strengths +
                                        availability + ledger evidence)

This is NOT an ML model. It is a readable aid with explicit overrides, and every
decision records the reason so the final audit shows *why* a task was routed.
"""
from __future__ import annotations

from dataclasses import dataclass

from .contracts import TaskSpec

# Category substrings that force the task to the host (GPT Chief Operator).
# Matching is case-insensitive substring against ``category`` and ``objective``.
HOST_OVERRIDE_MARKERS = (
    "auth", "authn", "authz", "authoriz", "login", "session",
    "secret", "credential", "token", "api_key", "apikey",
    "migration", "schema_change", "data_repair", "backfill", "destructive_data",
    "payment", "billing", "invoice", "financial", "money", "payout", "refund",
    "legal", "compliance", "tax",
    "public_api", "api_contract", "data_contract", "cross_service",
    "architecture", "cross_cutting", "crosscutting", "multi_subsystem",
    "production_config", "prod_config", "deploy_config",
    "merge_conflict", "conflict_resolution",
    "final_integration", "integration_final",
)

# Category / approval markers that require an explicit human gate before acting.
APPROVAL_MARKERS = (
    "destructive", "production", "prod_deploy", "delete", "drop_table",
    "paid_large", "payout", "refund", "irreversible", "wipe",
)


@dataclass
class RouteDecision:
    """The result of routing one task. ``tier`` is the lane; ``provider`` is an
    optional concrete pin; ``reason`` is human-readable; ``expert_pressure`` and
    ``hard_override`` make the decision auditable; ``needs_human_approval`` marks
    tasks that must pause for a human before execution."""
    task_id: str
    tier: str                      # host | expert | fast
    provider: str | None
    reason: str
    expert_pressure: int
    hard_override: bool
    needs_human_approval: bool
    advisor_preflight: bool        # high-risk host work -> suggest a Fable preflight


def verification_strength(task: TaskSpec) -> int:
    """0..3 estimate of how mechanically checkable the task is. A concrete
    verification command is the strongest signal; acceptance criteria add a
    little. Strong verification lowers expert pressure (a fast worker's output
    can be trusted because a gate will catch it)."""
    s = 0
    if task.verification_cmd:
        s += 2
    if task.acceptance_criteria:
        s += 1
    return min(3, s)


def expert_pressure(task: TaskSpec) -> int:
    """The transparent routing score from the MetaLoop outline."""
    return (
        2 * task.risk
        + 2 * task.complexity
        + task.context_size
        + task.novelty
        + task.ambiguity
        + task.blast_radius
        - task.latency_priority
        - verification_strength(task)
    )


def _matches(task: TaskSpec, markers: tuple[str, ...]) -> str | None:
    hay = f"{task.category} {task.objective}".lower()
    for m in markers:
        if m in hay:
            return m
    return None


def route(task: TaskSpec) -> RouteDecision:
    """Route one task. Hard overrides beat the heuristic; the heuristic beats
    ledger preference. Explicit ``preferred_tier == 'host'`` is honoured."""
    ep = expert_pressure(task)
    approval_hit = _matches(task, APPROVAL_MARKERS) or task.approval_level != "none"
    needs_human = bool(approval_hit)

    # 1. hard override -> host
    host_hit = _matches(task, HOST_OVERRIDE_MARKERS)
    if host_hit or task.preferred_tier == "host":
        reason = (
            f"hard override: '{host_hit}' is Chief-Operator-owned work"
            if host_hit else "task explicitly pinned to host tier"
        )
        # high-risk host work suggests a preflight advisor consult
        preflight = task.risk >= 2 or bool(host_hit and task.risk >= 1)
        return RouteDecision(
            task_id=task.id, tier="host", provider="host", reason=reason,
            expert_pressure=ep, hard_override=bool(host_hit),
            needs_human_approval=needs_human, advisor_preflight=preflight,
        )

    # 2. heuristic score
    if ep >= 8:
        return RouteDecision(
            task_id=task.id, tier="expert",
            provider=task.preferred_provider if task.preferred_tier == "expert" else None,
            reason=f"expert_pressure={ep} >= 8 -> expert lane",
            expert_pressure=ep, hard_override=False,
            needs_human_approval=needs_human, advisor_preflight=False,
        )
    if ep <= 3 and task.risk <= 1:
        return RouteDecision(
            task_id=task.id, tier="fast",
            provider=task.preferred_provider if task.preferred_tier == "fast" else None,
            reason=f"expert_pressure={ep} <= 3 and risk<=1 -> fast lane",
            expert_pressure=ep, hard_override=False,
            needs_human_approval=needs_human, advisor_preflight=False,
        )

    # 3. ambiguous middle band -> host decides using strengths/availability/ledger
    return RouteDecision(
        task_id=task.id, tier=task.preferred_tier if task.preferred_tier in ("expert", "fast") else "fast",
        provider=task.preferred_provider,
        reason=(f"expert_pressure={ep} in middle band -> host chooses "
                f"(prefer '{task.preferred_tier}')"),
        expert_pressure=ep, hard_override=False,
        needs_human_approval=needs_human, advisor_preflight=False,
    )


__all__ = [
    "RouteDecision", "route", "expert_pressure", "verification_strength",
    "HOST_OVERRIDE_MARKERS", "APPROVAL_MARKERS",
]
