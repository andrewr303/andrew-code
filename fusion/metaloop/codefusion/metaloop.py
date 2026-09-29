"""Meta LOOP — the core Codefusion control architecture.

From the product diagram:

    Main hot path:  Plan → Delegate → Verify → Synthesize  (± Escalate)
                         │
                         ▼
              Labor Layer: parallel cheap workers
                         │
                         ▼
              Results for verification → Orchestrator (GPT-5.6)

    Off hot path:   Orchestrator ⇄ Advisor (Fable 5)
                    strategic & critique consultation only
                    (on-demand critic — never on the main path)

Roles
-----
* **Orchestrator (GPT-5.6 / Codex)** — main plan, delegate subtasks, verify,
  synthesize, escalate. Always on the hot path.
* **Advisor (Fable 5)** — strategy, decomposition critique, risk spotting,
  taste. Premium "taste and judgment" loop. Consulted on demand only.
* **Workers (cheap parallel labor)** — e.g. Gemini Flash via Copilot/OpenCode.
  Homogeneous labor layer; many subtasks, low per-call cost.

This is deliberately *not* a peer multi-model panel. Peers (Fusion panel/council)
remain available as modes; Meta LOOP is the hierarchical default for real work.
"""

from __future__ import annotations

import json
import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from codefusion.config import load_config
from codefusion.dispatch import Reply, dispatch
from codefusion.detect import detect_agents
from codefusion.ledger import record_run
from codefusion.paths import project_state_dir

# Diagram defaults
ORCHESTRATOR_ROLE = "orchestrator"
ADVISOR_ROLE = "advisor"
WORKER_ROLE = "worker"

HOT_PATH = ("plan", "delegate", "verify", "synthesize", "escalate")


@dataclass
class MetaLoopRoles:
    """Resolved providers/models for the three diagram boxes."""

    orchestrator_provider: str = "codex"
    orchestrator_model: str = "gpt-5.6"
    orchestrator_effort: str = "xhigh"
    advisor_provider: str = "claude"  # Fable 5 board advisor surface
    advisor_model: str = "claude-opus-4-8"
    advisor_label: str = "Fable 5"
    worker_provider: str = "copilot"
    worker_model: str = "gemini-3.5-flash"
    worker_count: int = 4
    worker_label: str = "Gemini 3.5 Flash"

    def dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Subtask:
    id: str
    title: str
    instruction: str
    worker_index: int = 0
    result: str = ""
    status: str = "pending"  # pending | returned | error | timeout | skipped
    error: str = ""
    elapsed_s: float = 0.0

    def dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class MetaLoopResult:
    run_id: str
    task: str
    roles: dict[str, Any]
    plan: str = ""
    advisor_consulted: bool = False
    advisor_critique: str = ""
    subtasks: list[dict[str, Any]] = field(default_factory=list)
    verification: str = ""
    synthesis: str = ""
    escalated: bool = False
    escalation_note: str = ""
    ok: bool = False
    elapsed_s: float = 0.0
    phase_log: list[str] = field(default_factory=list)
    error: str = ""
    result_path: str = ""

    def dict(self) -> dict[str, Any]:
        return asdict(self)


def resolve_roles(
    *,
    worker_count: Optional[int] = None,
    consult_advisor: bool = False,
) -> MetaLoopRoles:
    """Map diagram roles onto installed CLIs (capability, not cost policy)."""
    cfg = load_config()
    agents = {a.provider: a for a in detect_agents()}

    # Orchestrator: always host conductor (Codex / gpt-5.6).
    orch_p = cfg.orchestrator_provider
    orch_m = cfg.orchestrator_model
    orch_e = cfg.orchestrator_effort

    # Advisor (Fable 5): prefer Claude as board advisor; fall back to grok, then agy.
    advisor_order = ["claude", "grok", "agy", "codex"]
    advisor_p = next(
        (p for p in advisor_order if p in agents and agents[p].status in {"available", "host-native"}),
        "claude",
    )
    advisor_m = ""
    if advisor_p in agents:
        advisor_m = agents[advisor_p].model
    if advisor_p == "claude" and not advisor_m:
        advisor_m = "claude-opus-4-8"

    # Labor layer: prefer copilot (gemini flash) → opencode → agy → claude.
    # Intentionally cheap/fast homogeneous workers when possible.
    labor_order = ["copilot", "opencode", "agy", "claude"]
    worker_p = next(
        (
            p
            for p in labor_order
            if p != orch_p
            and p in agents
            and agents[p].status == "available"
        ),
        "copilot",
    )
    worker_m = "gemini-3.5-flash" if worker_p == "copilot" else (
        agents[worker_p].model if worker_p in agents else ""
    )
    if worker_p == "copilot":
        worker_label = "Gemini 3.5 Flash"
    elif worker_p == "opencode":
        worker_label = worker_m or "OpenCode labor"
    else:
        worker_label = f"{worker_p} labor"

    n = worker_count if worker_count is not None else int(
        getattr(cfg, "metaloop_worker_count", 4) or 4
    )
    n = max(1, min(n, 8))

    return MetaLoopRoles(
        orchestrator_provider=orch_p,
        orchestrator_model=orch_m,
        orchestrator_effort=orch_e,
        advisor_provider=advisor_p,
        advisor_model=advisor_m,
        advisor_label="Fable 5",
        worker_provider=worker_p,
        worker_model=worker_m,
        worker_count=n,
        worker_label=worker_label,
    )


def _orch_dispatch(roles: MetaLoopRoles, prompt: str, *, timeout: Optional[int], cwd: Optional[Path]) -> Reply:
    return dispatch(
        roles.orchestrator_provider,
        prompt,
        model=roles.orchestrator_model,
        effort=roles.orchestrator_effort,
        allow_host=True,
        timeout=timeout,
        cwd=cwd,
    )


def _advisor_dispatch(roles: MetaLoopRoles, prompt: str, *, timeout: Optional[int], cwd: Optional[Path]) -> Reply:
    # Advisor is never the recursive host unless it's the only option.
    allow = roles.advisor_provider == roles.orchestrator_provider
    return dispatch(
        roles.advisor_provider,
        prompt,
        model=roles.advisor_model,
        allow_host=allow,
        timeout=timeout,
        cwd=cwd,
    )


def _worker_dispatch(
    roles: MetaLoopRoles,
    prompt: str,
    *,
    timeout: Optional[int],
    cwd: Optional[Path],
) -> Reply:
    allow = roles.worker_provider == roles.orchestrator_provider
    return dispatch(
        roles.worker_provider,
        prompt,
        model=roles.worker_model,
        allow_host=allow,
        timeout=timeout,
        cwd=cwd,
    )


def _parse_subtasks(plan_text: str, worker_count: int) -> list[Subtask]:
    """Extract SUBTASK blocks from orchestrator plan; fall back to N slices."""
    subtasks: list[Subtask] = []
    # Preferred structured format:
    #   SUBTASK 1: title
    #   <body until next SUBTASK or end>
    pattern = re.compile(
        r"(?im)^\s*SUBTASK\s*(\d+)\s*[:.\-)]\s*(.+?)\s*$"
    )
    matches = list(pattern.finditer(plan_text))
    if matches:
        for i, m in enumerate(matches):
            start = m.end()
            end = matches[i + 1].start() if i + 1 < len(matches) else len(plan_text)
            body = plan_text[start:end].strip()
            title = m.group(2).strip()
            subtasks.append(
                Subtask(
                    id=f"T{m.group(1)}",
                    title=title,
                    instruction=body or title,
                    worker_index=i % worker_count,
                )
            )
        return subtasks[:worker_count] if len(subtasks) > worker_count else subtasks

    # Bullet fallback
    bullets = re.findall(r"(?m)^\s*[-*]\s+(.+)$", plan_text)
    if len(bullets) >= 2:
        for i, b in enumerate(bullets[:worker_count]):
            subtasks.append(
                Subtask(
                    id=f"T{i + 1}",
                    title=b[:80],
                    instruction=b,
                    worker_index=i % worker_count,
                )
            )
        return subtasks

    # Last resort: N parallel angles on the same task
    angles = [
        "Explore and report findings with evidence paths.",
        "Propose a concrete implementation approach with file-level steps.",
        "List risks, edge cases, and tests that could fail.",
        "Draft the minimal patch outline or checklist to ship.",
        "Identify dependencies and sequencing constraints.",
        "Suggest verification commands that can fail.",
        "Note what should NOT be changed.",
        "Summarize open questions for the orchestrator.",
    ]
    for i in range(worker_count):
        subtasks.append(
            Subtask(
                id=f"T{i + 1}",
                title=f"Parallel angle {i + 1}",
                instruction=angles[i % len(angles)],
                worker_index=i,
            )
        )
    return subtasks


def _local_plan(task: str, n: int) -> str:
    return (
        f"PLAN (offline orchestrator fallback)\n"
        f"Goal: {task}\n\n"
        + "\n".join(
            f"SUBTASK {i + 1}: Workstream {i + 1}\n"
            f"Produce a concrete, evidence-bearing contribution for: {task}\n"
            f"Focus angle #{i + 1}. Name files/commands when possible.\n"
            for i in range(n)
        )
        + "\nSUCCESS: subtask outputs are specific and verifiable.\n"
    )


def _local_synthesis(task: str, plan: str, results: list[Subtask], critique: str) -> str:
    lines = [
        "# Meta LOOP synthesis (local fallback)",
        "",
        f"**Task:** {task}",
        "",
        "## Plan",
        plan[:2000],
        "",
    ]
    if critique:
        lines.extend(["## Advisor critique (Fable 5)", critique[:2000], ""])
    lines.append("## Worker results")
    for st in results:
        lines.append(f"### {st.id}: {st.title} [{st.status}]")
        lines.append(st.result[:1500] if st.result else st.error or "_(empty)_")
        lines.append("")
    lines.append(
        "_Conductor subprocess unavailable — merge is concatenation only. "
        "Auth codex/gpt-5.6 for full Plan→Verify→Synthesize._"
    )
    return "\n".join(lines)


def run_metaloop(
    task: str,
    *,
    consult_advisor: bool = False,
    force_advisor: bool = False,
    worker_count: Optional[int] = None,
    cwd: Optional[Path] = None,
    timeout: Optional[int] = None,
    run_orchestrator: bool = True,
) -> dict[str, Any]:
    """Execute the Meta LOOP hot path (+ optional Advisor consult)."""
    t0 = time.time()
    run_id = f"ml_{uuid.uuid4().hex[:12]}"
    roles = resolve_roles(worker_count=worker_count, consult_advisor=consult_advisor or force_advisor)
    cfg = load_config()
    timeout = timeout or cfg.panel_timeout_s
    log: list[str] = []
    result = MetaLoopResult(
        run_id=run_id,
        task=task,
        roles=roles.dict(),
    )

    def phase(msg: str) -> None:
        log.append(msg)
        result.phase_log = list(log)

    # ── 1. PLAN (Orchestrator, hot path) ───────────────────────────────────
    phase("plan:start")
    plan_prompt = f"""You are the Codefusion Meta LOOP Orchestrator ({roles.orchestrator_model}).
You are on the MAIN HOT PATH: Plan → Delegate → Verify → Synthesize.

Task:
{task}

Produce a short master plan, then decompose into exactly {roles.worker_count} parallel
SUBTASKS for a cheap labor layer ({roles.worker_label} workers).

Format strictly:

PLAN:
<3-8 lines strategy>

SUBTASK 1: <title>
<instructions for worker — self-contained, concrete, file/command aware>

SUBTASK 2: <title>
...

SUBTASK {roles.worker_count}: <title>
...

SUCCESS CRITERIA:
<what "done" means>

Do NOT implement everything yourself. Delegate labor. You will verify and synthesize later.
"""
    if run_orchestrator:
        plan_reply = _orch_dispatch(roles, plan_prompt, timeout=timeout, cwd=cwd)
        plan = plan_reply.text if plan_reply.ok else _local_plan(task, roles.worker_count)
        if not plan_reply.ok:
            phase(f"plan:fallback ({plan_reply.status}: {plan_reply.error})")
        else:
            phase("plan:ok")
    else:
        plan = _local_plan(task, roles.worker_count)
        phase("plan:offline")
    result.plan = plan

    # ── 2. ADVISOR (optional, OFF hot path) ────────────────────────────────
    # Board Advisor (Fable 5): on-demand consulted critic — not in hot path.
    should_consult = force_advisor or consult_advisor
    if not should_consult:
        # Auto-consult only when plan signals risk / ambiguity.
        low = (task + "\n" + plan).lower()
        should_consult = any(
            k in low
            for k in (
                "migrat",
                "production",
                "security",
                "architecture",
                "irreversible",
                "data loss",
                "breaking change",
                "uncertain",
                "tradeoff",
            )
        )
        if should_consult:
            phase("advisor:auto-trigger (risk/ambiguity signals)")

    critique = ""
    if should_consult:
        phase(f"advisor:consult ({roles.advisor_label} via {roles.advisor_provider}) — OFF hot path")
        advisor_prompt = f"""You are the Codefusion Board Advisor ({roles.advisor_label}).
You are NOT on the execution hot path. You are an on-demand critic.

Your job: Strategy, Decomposition Critique, Risk Spotting, Taste.
Premium "taste and judgment" only — do not rewrite the whole plan unless it is flawed.

User task:
{task}

Orchestrator plan + subtasks:
{plan}

Respond with:
1. STRATEGY VERDICT — sound / shaky / redo (one line)
2. DECOMPOSITION CRITIQUE — are subtasks parallel-safe and complete?
3. RISKS — what the plan misses
4. TASTE — what a senior engineer would change
5. ADJUSTMENTS — concrete edits to subtask list (or "none")
"""
        adv = _advisor_dispatch(roles, advisor_prompt, timeout=timeout, cwd=cwd)
        if adv.ok:
            critique = adv.text
            result.advisor_consulted = True
            result.advisor_critique = critique
            phase("advisor:ok")
            # Optional re-plan if advisor says redo (orchestrator absorbs critique)
            if run_orchestrator and re.search(r"\b(redo|shaky)\b", critique, re.I):
                phase("plan:revise-after-advisor")
                revise_prompt = f"""You are the Meta LOOP Orchestrator. The Board Advisor ({roles.advisor_label}) critiqued your plan.

Original task:
{task}

Your plan:
{plan}

Advisor critique:
{critique}

Produce a REVISED plan in the same SUBTASK format ({roles.worker_count} subtasks). Keep what was sound.
"""
                rev = _orch_dispatch(roles, revise_prompt, timeout=timeout, cwd=cwd)
                if rev.ok and rev.text.strip():
                    plan = rev.text
                    result.plan = plan
                    phase("plan:revised")
        else:
            phase(f"advisor:skip ({adv.status}: {adv.error})")
    else:
        phase("advisor:skipped (not consulted — stays off hot path)")

    # ── 3. DELEGATE + LABOR LAYER (parallel cheap workers) ─────────────────
    phase(f"delegate:labor-layer ({roles.worker_count}× {roles.worker_provider}/{roles.worker_label})")
    subtasks = _parse_subtasks(plan, roles.worker_count)
    if not subtasks:
        subtasks = _parse_subtasks(_local_plan(task, roles.worker_count), roles.worker_count)

    def _run_one(st: Subtask) -> Subtask:
        prompt = f"""You are Worker {st.worker_index + 1} in the Codefusion Meta LOOP labor layer
({roles.worker_label}). You execute ONE delegated subtask. Be concrete and evidence-bearing.
Do not re-plan the whole project. Do not wait for other workers.

Overall task:
{task}

Your subtask ({st.id}): {st.title}

Instructions:
{st.instruction}

Return:
- What you did / found
- Evidence (paths, commands, snippets)
- Residual risks
- Handoff notes for the Orchestrator
"""
        t1 = time.time()
        rep = _worker_dispatch(roles, prompt, timeout=timeout, cwd=cwd)
        st.elapsed_s = round(time.time() - t1, 2)
        if rep.ok:
            st.status = "returned"
            st.result = rep.text
        else:
            st.status = rep.status
            st.error = rep.error or rep.status
            st.result = rep.text or ""
        return st

    with ThreadPoolExecutor(max_workers=min(roles.worker_count, len(subtasks))) as pool:
        futs = [pool.submit(_run_one, st) for st in subtasks]
        done: list[Subtask] = []
        for fut in as_completed(futs):
            try:
                done.append(fut.result())
            except Exception as exc:  # noqa: BLE001
                done.append(
                    Subtask(
                        id="Terr",
                        title="worker crash",
                        instruction="",
                        status="error",
                        error=str(exc),
                    )
                )
    # Preserve T1..Tn order
    order = {st.id: i for i, st in enumerate(subtasks)}
    done.sort(key=lambda s: order.get(s.id, 99))
    result.subtasks = [s.dict() for s in done]
    returned = [s for s in done if s.status == "returned"]
    phase(f"labor:done returned={len(returned)}/{len(done)}")

    # ── 4. VERIFY (Orchestrator, hot path) ─────────────────────────────────
    phase("verify:start")
    worker_blob = "\n\n".join(
        f"### {s.id} {s.title} [{s.status}]\n{s.result or s.error or '(empty)'}"
        for s in done
    )
    verify_prompt = f"""You are the Meta LOOP Orchestrator ({roles.orchestrator_model}) on the VERIFY step.

Task:
{task}

Plan:
{plan}

Worker results (labor layer — treat absent workers as missing, not agreement):
{worker_blob}

Verify:
1. Which subtasks actually completed the success criteria?
2. Contradictions between workers?
3. What still needs work?
4. PASS / FAIL / PARTIAL on the overall goal
5. Escalation needed? (yes/no + why)
"""
    verification = ""
    if run_orchestrator:
        vrep = _orch_dispatch(roles, verify_prompt, timeout=timeout, cwd=cwd)
        if vrep.ok:
            verification = vrep.text
            phase("verify:ok")
        else:
            verification = (
                f"Offline verify: {len(returned)}/{len(done)} workers returned.\n"
                f"Orchestrator verify failed: {vrep.status} {vrep.error}"
            )
            phase(f"verify:fallback ({vrep.status})")
    else:
        verification = f"Offline verify: {len(returned)}/{len(done)} workers returned."
        phase("verify:offline")
    result.verification = verification

    if re.search(r"\b(escalat|FAIL)\b", verification, re.I) and "no escalat" not in verification.lower():
        result.escalated = True
        result.escalation_note = "Verification requested escalation or FAIL"
        phase("escalate:flagged")

    # ── 5. SYNTHESIZE (Orchestrator, hot path) ─────────────────────────────
    phase("synthesize:start")
    synth_prompt = f"""You are the Meta LOOP Orchestrator ({roles.orchestrator_model}) on SYNTHESIZE.

Produce the final deliverable for the user.

Task:
{task}

Plan:
{plan}

{"Advisor critique (Fable 5, off hot path):\n" + critique if critique else "Advisor: not consulted."}

Verification:
{verification}

Worker outputs:
{worker_blob}

Final response structure:
1. Verdict
2. Integrated answer / plan / patch guidance
3. Evidence
4. What workers disagreed on
5. Remaining risks
6. Next commands that can fail (verification)
"""
    if run_orchestrator:
        srep = _orch_dispatch(roles, synth_prompt, timeout=timeout, cwd=cwd)
        if srep.ok:
            result.synthesis = srep.text
            phase("synthesize:ok")
        else:
            result.synthesis = _local_synthesis(task, plan, done, critique)
            phase(f"synthesize:fallback ({srep.status})")
    else:
        result.synthesis = _local_synthesis(task, plan, done, critique)
        phase("synthesize:offline")

    result.ok = bool(returned) or bool(result.synthesis)
    result.elapsed_s = round(time.time() - t0, 2)
    result.phase_log = log

    # Persist
    out_dir = project_state_dir() / "runs" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = result.dict()
    path = out_dir / "result.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (out_dir / "stitched.md").write_text(_metaloop_markdown(payload), encoding="utf-8")
    result.result_path = str(path)
    payload["result_path"] = str(path)

    record_run(
        {
            "run_id": run_id,
            "task_type": "metaloop",
            "mode": "metaloop",
            "judge": roles.orchestrator_provider,
            "winner": roles.orchestrator_provider,
            "panelists": [
                {"provider": roles.worker_provider, "status": s.get("status")}
                for s in result.subtasks
            ],
            "advisor_consulted": result.advisor_consulted,
            "ok": result.ok,
        }
    )
    return payload


def _metaloop_markdown(payload: dict[str, Any]) -> str:
    roles = payload.get("roles") or {}
    lines = [
        f"# Meta LOOP `{payload.get('run_id')}`",
        "",
        f"- **orchestrator**: {roles.get('orchestrator_provider')} / {roles.get('orchestrator_model')}",
        f"- **advisor**: {roles.get('advisor_label')} via {roles.get('advisor_provider')} "
        f"({'consulted' if payload.get('advisor_consulted') else 'off hot path — not consulted'})",
        f"- **labor**: {roles.get('worker_count')}× {roles.get('worker_provider')} ({roles.get('worker_label')})",
        f"- **ok**: {payload.get('ok')}  **elapsed**: {payload.get('elapsed_s')}s",
        "",
        "## Hot path",
        "Plan → Delegate → Verify → Synthesize" + (" → Escalate" if payload.get("escalated") else ""),
        "",
        "## Task",
        payload.get("task") or "",
        "",
        "## Plan",
        payload.get("plan") or "",
        "",
    ]
    if payload.get("advisor_critique"):
        lines.extend(["## Advisor (Fable 5) — off hot path", payload["advisor_critique"], ""])
    lines.append("## Worker results")
    for st in payload.get("subtasks") or []:
        lines.append(f"### {st.get('id')}: {st.get('title')} [{st.get('status')}]")
        lines.append(st.get("result") or st.get("error") or "")
        lines.append("")
    lines.extend(["## Verification", payload.get("verification") or "", ""])
    lines.extend(["## Synthesis", payload.get("synthesis") or "", ""])
    lines.extend(["## Phase log", ""])
    for p in payload.get("phase_log") or []:
        lines.append(f"- {p}")
    return "\n".join(lines)


def format_metaloop(result: dict[str, Any]) -> str:
    roles = result.get("roles") or {}
    lines = [
        "✦ CODEFUSION · Meta LOOP",
        f"  run={result.get('run_id')}  ok={result.get('ok')}  elapsed={result.get('elapsed_s')}s",
        f"  Orchestrator (hot):  {roles.get('orchestrator_provider')} / {roles.get('orchestrator_model')}",
        f"  Advisor (off-path):  {roles.get('advisor_label')} via {roles.get('advisor_provider')} · "
        f"{'consulted' if result.get('advisor_consulted') else 'not consulted'}",
        f"  Labor (parallel):    {roles.get('worker_count')}× {roles.get('worker_provider')} "
        f"({roles.get('worker_label')})",
        "",
        "  hot path: Plan → Delegate → Verify → Synthesize"
        + (" → Escalate" if result.get("escalated") else ""),
        "",
    ]
    for p in result.get("phase_log") or []:
        lines.append(f"  · {p}")
    lines.append("")
    for st in result.get("subtasks") or []:
        glyph = "🟢" if st.get("status") == "returned" else "⬛"
        lines.append(f"  {glyph} {st.get('id')} {st.get('title')} [{st.get('status')}]")
    if result.get("synthesis"):
        lines.append("")
        lines.append("── synthesis ──")
        synth = result["synthesis"]
        if len(synth) > 4000:
            synth = synth[:4000] + "\n… [truncated; see stitched.md]"
        lines.append(synth)
    if result.get("result_path"):
        lines.append("")
        lines.append(f"  saved: {result['result_path']}")
    return "\n".join(lines)


def diagram_text() -> str:
    return """
Meta LOOP with Fable 5, GPT-5.6 and Gemini labor
================================================

                    ┌─────────────────────────┐     Strategic & Critique
   Main hot path:   │  Orchestrator GPT-5.6   │ ──consultation──▶ ┌──────────────┐
   Plan→Delegate→   │  Plan, Delegate, Verify, │ ◀──dashed────────│ Advisor      │
   Verify→Synthesize│  Synthesize, Escalate   │                  │ Fable 5      │
                    └───────────┬─────────────┘                  │ (off hot path│
                                │ delegated subtasks               │  on-demand)  │
                                ▼                                  └──────────────┘
              ┌────────┬────────┬────────┬────────┐
              │Worker A│Worker B│Worker C│Worker D│  cheap parallel labor
              │ Flash  │ Flash  │ Flash  │ Flash  │
              └────┬───┴───┬────┴───┬────┴───┬────┘
                   └───────┴────────┴────────┘
                           results for verification
""".strip()
