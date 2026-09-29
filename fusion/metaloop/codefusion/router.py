"""Capability-first collaboration-mode router (replaces Puppetmaster cost routing).

The Conductor (GPT-5.6 via Codex) remains the final decider. This module gives a
fast, deterministic default plus agent assignment by *strength*, not cost.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from codefusion.config import CORE_MODES, SWARM_PATTERNS, load_config
from codefusion.detect import detect_agents, live_panelists


@dataclass
class RouteDecision:
    mode: str
    task_type: str
    reason: str
    panel: list[str]
    assignments: dict[str, str] = field(default_factory=dict)
    suggested_pattern: Optional[str] = None
    confidence: float = 0.6
    signals: dict[str, Any] = field(default_factory=dict)

    def dict(self) -> dict[str, Any]:
        return asdict(self)


def _has(text: str, pattern: str) -> bool:
    return bool(re.search(pattern, text, flags=re.I))


def classify_signals(task: str) -> dict[str, Any]:
    low = task.lower()
    length = len(task)
    return {
        "length": length,
        "code": int(
            _has(
                low,
                r"```|def |function |class |refactor|implement|fix (the )?(bug|null|npe|crash)|"
                r"write (a|the|some)|build (a|an|the)|debug|stack ?trace|compile|"
                r"unit test|migrat|typescript|python|rust|null pointer|typeerror|segfault|"
                r"pull request|\bpr\b|codebase|repo",
            )
        ),
        "verifiable": int(
            _has(
                low,
                r"calculate|how many|what is the (value|result|sum|total)|solve|"
                r"compute|convert |\bvalue of\b",
            )
        ),
        "deliberate": int(
            _has(
                low,
                r"compare|contrast|tradeoff|trade-off|pros and cons|should (we|i)|"
                r"which (is|one)|evaluate|architecture|design decision|strategy|"
                r"decide|recommend|vs\.?|versus|best approach",
            )
        ),
        "debate": int(
            _has(
                low,
                r"either|or should|a or b|for and against|argue|debate|opposing|"
                r"two options|this or that",
            )
        ),
        "large": int(
            _has(
                low,
                r"across (the|all|multiple)|every file|whole (codebase|repo)|"
                r"each of|in parallel|many files|migrate (the|all)|monorepo",
            )
        ),
        "security": int(
            _has(low, r"security|auth|vuln|cve|xss|injection|threat|permission|rls")
        ),
        "ml": int(
            _has(
                low,
                r"\b(train|training|model|dataset|loss|epoch|inference|embedding|"
                r"fine-?tun|hyperparam|ml|gpu)\b",
            )
        ),
        "adversarial": int(
            _has(low, r"break|adversar|red team|edge case|find bugs|stress test")
        ),
    }


def _pick_by_strength(need: str, available: list[str], roster_strengths: dict[str, list[str]]) -> Optional[str]:
    need_l = need.lower()
    scored: list[tuple[int, str]] = []
    for prov in available:
        strengths = [s.lower() for s in roster_strengths.get(prov, [])]
        score = sum(1 for s in strengths if need_l in s or s in need_l)
        # Soft keyword boosts
        if need_l in {"adversarial", "breaker", "edge"} and any(
            k in strengths for k in ("adversarial", "edge cases", "realtime")
        ):
            score += 3
        if need_l in {"planning", "analysis"} and any(
            k in strengths for k in ("planning", "codebase reasoning", "analysis", "reasoning")
        ):
            score += 3
        if need_l in {"draft", "implement", "volume"} and any(
            k in strengths for k in ("drafts", "boilerplate", "volume", "speed")
        ):
            score += 3
        if need_l in {"fast", "glue", "simple"} and any(
            k in strengths for k in ("fast", "glue", "simple fixes")
        ):
            score += 3
        if need_l in {"orchestrate", "judge", "integrate"} and prov == load_config().orchestrator_provider:
            score += 5
        scored.append((score, prov))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return scored[0][1] if scored and scored[0][0] > 0 else (available[0] if available else None)


def assign_roles(mode: str, task_type: str, signals: dict[str, Any]) -> dict[str, str]:
    """Map fusion roles to available agents by capability (not cost)."""
    cfg = load_config()
    agents = detect_agents()
    available = [a.provider for a in agents if a.status in {"available", "host-native"}]
    strengths = {
        a.provider: list(a.strengths)
        for a in agents
    }
    # Ensure roster strengths filled
    for entry in cfg.roster:
        strengths.setdefault(entry["provider"], list(entry.get("strengths") or []))

    host = cfg.orchestrator_provider
    external = [p for p in available if p != host]
    assignments: dict[str, str] = {
        "conductor": host,
        "judge": host,
    }

    if mode in {"panel", "council", "vote"}:
        assignments["panel"] = ",".join(external)
    elif mode == "debate":
        pro = _pick_by_strength("planning", external, strengths) or (external[0] if external else host)
        rest = [p for p in external if p != pro]
        con = _pick_by_strength("adversarial", rest, strengths) or (rest[0] if rest else host)
        assignments["pro"] = pro
        assignments["con"] = con
        assignments["adjudicator"] = host
    elif mode == "metaloop" or task_type == "metaloop":
        # Diagram roles: Orchestrator / Advisor (off-path) / Labor workers.
        assignments["orchestrator"] = host
        # Fable 5 board advisor: prefer Claude, then grok, then best reasoning pick.
        if "claude" in available:
            assignments["advisor"] = "claude"
        elif "grok" in available:
            assignments["advisor"] = "grok"
        else:
            assignments["advisor"] = _pick_by_strength("reasoning", external, strengths) or host
        # Homogeneous cheap labor layer (diagram: Gemini Flash via copilot).
        if "copilot" in available:
            labor = "copilot"
        else:
            labor = _pick_by_strength("fast", external, strengths) or (
                external[0] if external else host
            )
        assignments["labor"] = labor
        assignments["worker"] = labor
    elif mode == "swarm" or task_type == "code":
        assignments["planner"] = _pick_by_strength("planning", external, strengths) or host
        assignments["implementer"] = _pick_by_strength("draft", external, strengths) or host
        assignments["breaker"] = _pick_by_strength("adversarial", external, strengths) or host
        assignments["fast"] = _pick_by_strength("fast", external, strengths) or host
        assignments["integrator"] = host
    elif signals.get("ml"):
        assignments["analyst"] = _pick_by_strength("analysis", external, strengths) or host
        assignments["implementer"] = _pick_by_strength("draft", external, strengths) or host
        assignments["skeptic"] = _pick_by_strength("adversarial", external, strengths) or host

    if signals.get("security"):
        assignments["security_reviewer"] = _pick_by_strength("adversarial", external, strengths) or host

    return {k: v for k, v in assignments.items() if v}


def route(task: str, *, force_mode: Optional[str] = None) -> RouteDecision:
    """Advise collaboration mode + agent assignments for *task*."""
    cfg = load_config()
    signals = classify_signals(task)
    length = signals["length"]

    if force_mode and force_mode not in {"auto", ""}:
        mode = force_mode
        if mode in {"metaloop", "meta-loop", "meta_loop", "loop"}:
            task_type = "metaloop"
            reason = "forced Meta LOOP (Orchestrator / Advisor / Labor)"
            pattern = None
            mode_out = "metaloop"
        elif mode in SWARM_PATTERNS:
            task_type = f"swarm:{mode}"
            reason = f"forced swarm pattern '{mode}'"
            pattern = mode
            mode_out = "swarm"
        elif mode in CORE_MODES:
            task_type = "forced"
            reason = f"forced mode '{mode}'"
            pattern = None
            mode_out = mode
        else:
            task_type = "forced"
            reason = f"unknown forced mode '{mode}', falling back to panel"
            pattern = None
            mode_out = "panel"
    else:
        pattern = None
        if length < 120 and not any(
            signals[k] for k in ("code", "deliberate", "verifiable", "debate")
        ):
            mode_out, task_type = "solo", "quick"
            reason = "short single-answer prompt — conductor answers directly"
        elif signals["verifiable"] and length < 400:
            mode_out, task_type = "vote", "verifiable"
            reason = "checkable answer — model-free majority is reliable"
        elif signals["debate"]:
            mode_out, task_type = "debate", "decision"
            reason = "contested either/or — pro/con + adjudication (peer mode)"
        elif signals["deliberate"] and not signals["code"] and not signals["large"]:
            # Open strategy decisions still benefit from peer council;
            # large/architecture work goes Meta LOOP with optional Advisor.
            mode_out, task_type = "council", "decision"
            reason = "high-stakes open decision — multi-round peer council"
        elif signals["code"] or signals["large"] or signals.get("ml") or signals["deliberate"]:
            # Default architecture for real work: Meta LOOP diagram.
            mode_out, task_type = "metaloop", "metaloop"
            reason = (
                "Meta LOOP hot path — Orchestrator (GPT-5.6) Plan→Delegate→Verify→Synthesize; "
                "parallel cheap labor; Advisor (Fable 5) only on demand off hot path"
            )
            if signals["adversarial"]:
                pattern = "breaker"
            elif signals.get("ml"):
                pattern = "heavy"
        elif signals["adversarial"] and signals["code"]:
            mode_out, task_type = "metaloop", "metaloop"
            reason = "Meta LOOP with adversarial verify pressure"
            pattern = "breaker"
        else:
            mode_out, task_type = "panel", "research"
            reason = "open research — peer panel + synthesis (not Meta LOOP labor)"

    panel = [a.provider for a in live_panelists()]
    assignments = assign_roles(mode_out, task_type, signals)

    # Confidence: more panelists and clearer signals → higher.
    conf = 0.55
    if sum(1 for k, v in signals.items() if k != "length" and v):
        conf += 0.15
    if len(panel) >= 2:
        conf += 0.15
    if force_mode and force_mode not in {"auto", ""}:
        conf = 0.95

    return RouteDecision(
        mode=mode_out,
        task_type=task_type,
        reason=reason,
        panel=panel,
        assignments=assignments,
        suggested_pattern=pattern,
        confidence=min(conf, 0.98),
        signals=signals,
    )


def format_route(decision: RouteDecision) -> str:
    lines = [
        f"MODE={decision.mode}",
        f"TASK_TYPE={decision.task_type}",
        f"REASON={decision.reason}",
        f"CONFIDENCE={decision.confidence:.2f}",
        f"PANEL={','.join(decision.panel) or 'none'}",
        f"CONDUCTOR={load_config().orchestrator_provider}/{load_config().orchestrator_model}",
    ]
    if decision.suggested_pattern:
        lines.append(f"PATTERN={decision.suggested_pattern}")
    for role, agent in decision.assignments.items():
        lines.append(f"ASSIGN_{role.upper()}={agent}")
    return "\n".join(lines)
