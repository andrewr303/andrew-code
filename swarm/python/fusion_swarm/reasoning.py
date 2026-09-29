"""Agent-level reasoning techniques — make a SINGLE panelist stronger.

Ported from swarms.agents (consistency_agent, flexion_agent/reflexion, gkp_agent,
reasoning_duo). These wrap one provider; the Fusion conductor can apply any of
them to any panelist (e.g. run a reflexion-wrapped codex as one panel member).
"""
from __future__ import annotations

import re
from collections import Counter

from .adapter import dispatch


def reflexion(provider, task, iterations=2, timeout=None):
    """Draft → self-critique → revise, looped. (Reflexion.)"""
    steps = []
    draft = dispatch(provider, f"Task: {task}\n\nGive your best complete answer.", timeout=timeout)
    steps.append({"phase": "draft", "text": draft.text})
    cur = draft.text
    for i in range(int(iterations)):
        crit = dispatch(
            provider,
            f"Task: {task}\n\nYour current answer:\n{cur}\n\nCritique it harshly: what is wrong, "
            f"missing, unjustified, or likely to fail? List concrete, specific flaws only — no praise.",
            timeout=timeout,
        )
        steps.append({"phase": f"critique-{i+1}", "text": crit.text})
        rev = dispatch(
            provider,
            f"Task: {task}\n\nPrevious answer:\n{cur}\n\nValid critique:\n{crit.text}\n\n"
            f"Produce an improved answer that fixes every valid flaw. Return only the improved answer.",
            timeout=timeout,
        )
        steps.append({"phase": f"revision-{i+1}", "text": rev.text})
        if rev.ok and rev.text.strip():
            cur = rev.text
    return {
        "pattern": "reflexion", "provider": provider, "task": task,
        "iterations": int(iterations), "steps": steps, "final": cur,
    }


def self_consistency(provider, task, samples=3, timeout=None):
    """Sample the same panelist N times; majority answer wins. (Self-consistency.)"""
    outs = []
    for _ in range(int(samples)):
        r = dispatch(
            provider,
            f"Task: {task}\n\nReason step by step, then give your final answer on its own line "
            f"starting with 'ANSWER:'.",
            timeout=timeout,
        )
        outs.append(r.text)

    def key(t):
        m = re.findall(r"ANSWER:\s*(.+)", t)
        if m:
            return m[-1].strip().lower()
        lines = [l for l in t.strip().splitlines() if l.strip()]
        return lines[-1].strip().lower() if lines else ""

    keys = [key(o) for o in outs if o.strip()]
    if keys:
        win, n = Counter(keys).most_common(1)[0]
        agreement = round(n / len(keys), 2)
    else:
        win, agreement = "", 0.0
    return {
        "pattern": "self_consistency", "provider": provider, "task": task,
        "samples": int(samples), "answers": outs, "consensus": win, "agreement": agreement,
    }


def gkp(provider, task, timeout=None):
    """Generate relevant knowledge first, then answer using it. (Generated-Knowledge Prompting.)"""
    know = dispatch(
        provider,
        f"Before answering, list the key facts, definitions, constraints, and considerations "
        f"relevant to this task. Do NOT answer it yet — just the knowledge:\n{task}",
        timeout=timeout,
    )
    ans = dispatch(
        provider,
        f"Task: {task}\n\nRelevant knowledge you assembled:\n{know.text}\n\n"
        f"Now answer the task, grounded in that knowledge.",
        timeout=timeout,
    )
    return {
        "pattern": "gkp", "provider": provider, "task": task,
        "knowledge": know.text, "final": ans.text,
    }
