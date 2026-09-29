"""AgentRearrange-style flow DSL over the Fusion panel.

Ported from swarms.structs.AgentRearrange. A flow string defines stages; agents
within a stage run in parallel, stages run in sequence with the running context
passed forward:

    "codex -> copilot, opencode -> grok"
      stage1: codex
      stage2: copilot + opencode (parallel)
      stage3: grok

Agent tokens are provider names (codex/copilot/opencode/grok). This gives
explicit, readable control over which panelist does what, in what order.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from .adapter import DEFAULT_PANEL, dispatch


def parse(flow: str):
    stages = []
    for stage in flow.split("->"):
        agents = [a.strip() for a in stage.split(",") if a.strip()]
        if agents:
            stages.append(agents)
    return stages


def validate(flow: str):
    """Return a list of unknown agent tokens (empty = valid)."""
    known = set(DEFAULT_PANEL)
    unknown = []
    for stage in parse(flow):
        for a in stage:
            if a not in known:
                unknown.append(a)
    return unknown


def run(task, flow, timeout=None):
    stages = parse(flow)
    context = f"TASK:\n{task}"
    transcript = []
    for i, agents in enumerate(stages, 1):
        with ThreadPoolExecutor(max_workers=max(1, len(agents))) as ex:
            futs = {
                ex.submit(
                    dispatch,
                    a,
                    f"{context}\n\nYou are stage agent '{a}'. Do your part of the task and "
                    f"pass forward useful, complete output for the next stage.",
                    timeout=timeout,
                ): a
                for a in agents
            }
            res = {futs[f]: f.result() for f in futs}
        outs = []
        for a in agents:
            r = res[a]
            outs.append(f"[{a}]\n{r.text}")
            transcript.append({"stage": i, "agent": a, "status": r.status, "text": r.text})
        context = f"TASK:\n{task}\n\nWork so far (feed into your stage):\n\n" + "\n\n".join(outs)
    return {
        "pattern": "flow",
        "task": task,
        "flow": flow,
        "stages": stages,
        "transcript": transcript,
        "final": context,
    }
