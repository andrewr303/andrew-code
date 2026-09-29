"""Codefusion orchestrator — Fusion modes under a GPT-5.6 conductor.

The conductor (Codex / gpt-5.6 by default) chooses and synthesizes.
External CLIs fan out as panelists. Durable job board is optional via
the Puppetmaster bridge.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any, Optional

from codefusion.config import load_config
from codefusion.dispatch import Reply, dispatch, panel
from codefusion.ledger import record_run
from codefusion.paths import project_state_dir
from codefusion.router import RouteDecision, route


def _run_id() -> str:
    return f"cf_{uuid.uuid4().hex[:12]}"


def _write_run(run_id: str, payload: dict[str, Any]) -> Path:
    d = project_state_dir() / "runs" / run_id
    d.mkdir(parents=True, exist_ok=True)
    path = d / "result.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # Human-readable synthesis
    md = d / "stitched.md"
    md.write_text(_to_markdown(payload), encoding="utf-8")
    return path


def _to_markdown(payload: dict[str, Any]) -> str:
    lines = [
        f"# Codefusion run `{payload.get('run_id')}`",
        "",
        f"- **mode**: {payload.get('mode')}",
        f"- **task_type**: {payload.get('task_type')}",
        f"- **conductor**: {payload.get('host')} / {payload.get('orchestrator_model')}",
        f"- **ok**: {payload.get('ok')}",
        "",
        "## Task",
        "",
        payload.get("task") or "",
        "",
        "## Route",
        "",
        f"```\n{payload.get('route_text', '')}\n```",
        "",
    ]
    replies = payload.get("replies") or {}
    if replies:
        lines.append("## Panel replies")
        lines.append("")
        for prov, rep in replies.items():
            st = rep.get("status") if isinstance(rep, dict) else "?"
            lines.append(f"### {prov} ({st})")
            lines.append("")
            text = rep.get("text") if isinstance(rep, dict) else str(rep)
            lines.append(text or "_(empty)_")
            lines.append("")
    if payload.get("synthesis"):
        lines.extend(["## Synthesis", "", payload["synthesis"], ""])
    if payload.get("vote"):
        lines.extend(["## Vote", "", "```json", json.dumps(payload["vote"], indent=2), "```", ""])
    return "\n".join(lines)


def _conductor_synthesize(
    task: str,
    mode: str,
    panel_result: dict[str, Any],
    decision: RouteDecision,
    *,
    run_conductor: bool,
) -> str:
    """Ask the host conductor to synthesize, or fall back to local merge."""
    parts = []
    replies = panel_result.get("replies") or {}
    for prov, rep in replies.items():
        if not isinstance(rep, dict):
            continue
        if rep.get("status") != "returned":
            parts.append(f"### {prov}: ABSENT ({rep.get('status')})\n{rep.get('error') or ''}")
            continue
        parts.append(f"### {prov}\n{rep.get('text') or ''}")

    if not run_conductor:
        return _local_synthesis(task, mode, replies, decision)

    cfg = load_config()
    prompt = f"""You are the Codefusion conductor ({cfg.orchestrator_model}).
Mode: {mode}. Task type: {decision.task_type}.
Reason for mode: {decision.reason}.

User task:
{task}

Panel replies (absent ≠ agreement — do not invent missing views):

{chr(10).join(parts) if parts else "(no panel replies)"}

Produce a calibrated synthesis with:
1. Verdict / answer
2. What the panel agreed on
3. Material disagreements
4. Minority report (if any)
5. Recommended next actions
6. Confidence (0-100) and what would change your mind
"""
    # allow_host=True so codex can run as synthesizer subprocess when needed
    reply = dispatch(cfg.orchestrator_provider, prompt, allow_host=True)
    if reply.ok and reply.text.strip():
        return reply.text.strip()
    return _local_synthesis(task, mode, replies, decision) + (
        f"\n\n_(conductor subprocess unavailable: {reply.error or reply.status})_"
    )


def _local_synthesis(
    task: str,
    mode: str,
    replies: dict[str, Any],
    decision: RouteDecision,
) -> str:
    returned = [
        (p, r) for p, r in replies.items()
        if isinstance(r, dict) and r.get("status") == "returned" and r.get("text")
    ]
    absent = [
        p for p, r in replies.items()
        if not (isinstance(r, dict) and r.get("status") == "returned")
    ]
    lines = [
        f"**Codefusion local synthesis** (mode={mode})",
        "",
        f"Task: {task[:500]}",
        "",
        f"Route: {decision.reason}",
        "",
    ]
    if not returned:
        lines.append("No panelist returned a usable answer. Run `codefusion doctor` and retry.")
        return "\n".join(lines)
    lines.append(f"Returned ({len(returned)}): " + ", ".join(p for p, _ in returned))
    if absent:
        lines.append(f"Absent: {', '.join(absent)}")
    lines.append("")
    lines.append("### Concatenated panel (conductor offline merge)")
    lines.append("")
    for prov, rep in returned:
        lines.append(f"#### {prov}")
        lines.append(rep.get("text", ""))
        lines.append("")
    lines.append(
        "_Tip: install/auth the host conductor (codex + gpt-5.6) for full judged synthesis._"
    )
    return "\n".join(lines)


def _majority_vote(replies: dict[str, Any]) -> dict[str, Any]:
    from collections import Counter

    answers: list[str] = []
    detail = {}
    for prov, rep in replies.items():
        if not isinstance(rep, dict) or rep.get("status") != "returned":
            continue
        text = (rep.get("text") or "").strip()
        # Normalize first non-empty line as the ballot.
        ballot = text.splitlines()[0].strip() if text else ""
        if ballot:
            answers.append(ballot)
            detail[prov] = ballot
    counts = Counter(answers)
    winner, n = counts.most_common(1)[0] if counts else ("", 0)
    return {
        "winner": winner,
        "votes": n,
        "total": len(answers),
        "ballots": detail,
        "tally": dict(counts),
    }


def run_task(
    task: str,
    *,
    mode: Optional[str] = None,
    providers: Optional[list[str]] = None,
    cwd: Optional[Path] = None,
    synthesize: bool = True,
    run_conductor: bool = True,
    timeout: Optional[int] = None,
    consult_advisor: bool = False,
    force_advisor: bool = False,
    worker_count: Optional[int] = None,
) -> dict[str, Any]:
    """Execute a Codefusion collaboration mode for *task*."""
    t0 = time.time()
    decision = route(task, force_mode=mode)
    cfg = load_config()
    run_id = _run_id()
    chosen = decision.mode

    # Meta LOOP is the hierarchical default for real work (see metaloop.py).
    if chosen == "metaloop":
        from codefusion.metaloop import run_metaloop

        return run_metaloop(
            task,
            consult_advisor=consult_advisor,
            force_advisor=force_advisor,
            worker_count=worker_count,
            cwd=cwd,
            timeout=timeout,
            run_orchestrator=run_conductor,
        )

    base: dict[str, Any] = {
        "run_id": run_id,
        "product": "codefusion",
        "task": task,
        "mode": chosen,
        "task_type": decision.task_type,
        "route": decision.dict(),
        "route_text": (
            f"{decision.mode} · {decision.reason} · panel={','.join(decision.panel)}"
        ),
        "host": cfg.orchestrator_provider,
        "orchestrator_model": cfg.orchestrator_model,
        "assignments": decision.assignments,
        "suggested_pattern": decision.suggested_pattern,
        "ts": time.time(),
    }

    if chosen == "solo":
        # Conductor-only.
        reply = dispatch(
            cfg.orchestrator_provider,
            task,
            model=cfg.orchestrator_model,
            effort=cfg.orchestrator_effort,
            allow_host=True,
            cwd=cwd,
            timeout=timeout,
        )
        base.update(
            {
                "replies": {cfg.orchestrator_provider: reply.dict()},
                "synthesis": reply.text if reply.ok else "",
                "ok": reply.ok,
                "error": reply.error,
            }
        )
    elif chosen == "vote":
        panel_result = panel(task, providers=providers, timeout=timeout, cwd=cwd)
        vote = _majority_vote(panel_result.get("replies") or {})
        base.update(
            {
                "replies": panel_result.get("replies"),
                "status": panel_result.get("status"),
                "vote": vote,
                "synthesis": (
                    f"Majority answer ({vote.get('votes')}/{vote.get('total')}): "
                    f"{vote.get('winner') or '(no ballots)'}"
                ),
                "ok": bool(vote.get("winner")),
            }
        )
    elif chosen == "debate":
        assignments = decision.assignments
        pro_p = assignments.get("pro")
        con_p = assignments.get("con")
        pro_prompt = f"Argue FOR this position / approach. Be concrete.\n\nTopic:\n{task}"
        con_prompt = f"Argue AGAINST this position / approach. Be concrete.\n\nTopic:\n{task}"
        replies: dict[str, Any] = {}
        if pro_p:
            replies[pro_p] = dispatch(pro_p, pro_prompt, cwd=cwd, timeout=timeout).dict()
        if con_p and con_p != pro_p:
            replies[con_p] = dispatch(con_p, con_prompt, cwd=cwd, timeout=timeout).dict()
        # Fill remaining panel for context if sparse
        if len(replies) < 2:
            extra = panel(task, providers=providers, timeout=timeout, cwd=cwd)
            for k, v in (extra.get("replies") or {}).items():
                replies.setdefault(k, v)
        panel_result = {"replies": replies, "ok": any(
            isinstance(r, dict) and r.get("status") == "returned" for r in replies.values()
        )}
        synthesis = (
            _conductor_synthesize(task, "debate", panel_result, decision, run_conductor=run_conductor)
            if synthesize
            else ""
        )
        base.update(
            {
                "replies": replies,
                "synthesis": synthesis,
                "ok": panel_result["ok"],
            }
        )
    else:
        # panel | council | swarm (basic fan-out; advanced patterns via swarm module)
        prompt = task
        if chosen == "council":
            prompt = (
                "You are a council panelist. Give an independent position with "
                "evidence, risks, and a clear recommendation. Do not hedge into "
                "generic consensus.\n\n"
                f"Decision:\n{task}"
            )
        elif chosen == "swarm":
            roles = decision.assignments
            prompt = (
                "You are a swarm worker. Produce a concrete, actionable contribution "
                f"for this multi-agent build. Your likely role hints: {roles}.\n\n"
                f"Task:\n{task}"
            )
        panel_result = panel(task if chosen == "panel" else prompt, providers=providers, timeout=timeout, cwd=cwd)
        synthesis = (
            _conductor_synthesize(
                task, chosen, panel_result, decision, run_conductor=synthesize and run_conductor
            )
            if synthesize
            else ""
        )
        base.update(
            {
                "replies": panel_result.get("replies"),
                "status": panel_result.get("status"),
                "returned": panel_result.get("returned"),
                "synthesis": synthesis,
                "ok": bool(panel_result.get("ok")),
                "error": panel_result.get("error"),
            }
        )

    base["elapsed_s"] = round(time.time() - t0, 2)
    path = _write_run(run_id, base)
    base["result_path"] = str(path)

    # Ledger
    panelists = []
    for prov, rep in (base.get("replies") or {}).items():
        if isinstance(rep, dict):
            panelists.append({"provider": prov, "status": rep.get("status")})
    record_run(
        {
            "run_id": run_id,
            "task_type": decision.task_type,
            "mode": chosen,
            "judge": cfg.orchestrator_provider,
            "winner": (base.get("vote") or {}).get("winner")
            or (base.get("returned") or [None])[0],
            "panelists": panelists,
            "ok": base.get("ok"),
        }
    )
    return base


def format_run_summary(result: dict[str, Any]) -> str:
    lines = [
        f"✦ CODEFUSION · mode={result.get('mode')} · "
        f"conductor={result.get('host')}/{result.get('orchestrator_model')} · "
        f"run={result.get('run_id')}",
        f"  {result.get('route_text')}",
        f"  ok={result.get('ok')}  elapsed={result.get('elapsed_s')}s",
        f"  saved: {result.get('result_path')}",
        "",
    ]
    replies = result.get("replies") or {}
    for prov, rep in replies.items():
        if not isinstance(rep, dict):
            continue
        st = rep.get("status")
        glyph = "🟢" if st == "returned" else ("🟡" if st in {"timeout", "degraded"} else "⬛")
        elapsed = rep.get("elapsed_s")
        lines.append(f"  {glyph} {prov}: {st}" + (f" ({elapsed:.1f}s)" if elapsed else ""))
    if result.get("vote"):
        v = result["vote"]
        lines.append("")
        lines.append(f"  vote winner: {v.get('winner')} ({v.get('votes')}/{v.get('total')})")
    if result.get("synthesis"):
        lines.append("")
        lines.append("── synthesis ──")
        synth = result["synthesis"]
        # Cap console dump
        if len(synth) > 4000:
            synth = synth[:4000] + "\n… [truncated; see stitched.md]"
        lines.append(synth)
    if result.get("error"):
        lines.append(f"\n  error: {result['error']}")
    return "\n".join(lines)
