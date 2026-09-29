"""Generator → Evaluator → gate refine loop (GAN-style).

Ported from swarms planner_generator_evaluator. A generator panelist produces an
answer; an evaluator panelist scores it 0-100 against the task and gives concrete
feedback; if it's below the threshold, the generator revises using that feedback.
Loops until the score clears the threshold or max_rounds is hit. A deterministic
quality gate instead of "looks good enough".
"""
from __future__ import annotations

import re

from .adapter import available, dispatch
from .synth import pick_aggregator


def _score(text: str):
    m = re.search(r"SCORE:\s*(\d{1,3})", text)
    if not m:
        m = re.search(r"(\d{1,3})\s*/\s*100", text)
    if m:
        return max(0, min(100, int(m.group(1))))
    return None


def run(task, generator="codex", evaluator="copilot", threshold=80, max_rounds=3, timeout=None):
    provs = available()
    gen = pick_aggregator(provs, generator)
    ev = pick_aggregator([p for p in provs if p != gen] or provs, evaluator)
    rounds = []
    answer = None
    feedback = ""
    for rnd in range(1, int(max_rounds) + 1):
        gprompt = f"Task: {task}\n\nProduce your best complete answer."
        if answer:
            gprompt += (
                f"\n\nYour prior answer:\n{answer}\n\nEvaluator feedback to address:\n{feedback}\n\n"
                f"Return an improved answer that fixes every valid point."
            )
        g = dispatch(gen, gprompt, timeout=timeout)
        if g.ok and g.text.strip():
            answer = g.text
        e = dispatch(
            ev,
            f"Evaluate the answer to this task on a 0-100 scale for correctness, completeness, "
            f"and usefulness. Give concrete, specific improvement feedback, then end with a line "
            f"formatted EXACTLY 'SCORE: <n>'.\n\nTask: {task}\n\nAnswer:\n{answer}",
            timeout=timeout,
        )
        sc = _score(e.text) if e.ok else None
        feedback = e.text
        rounds.append({
            "round": rnd, "generator": gen, "evaluator": ev,
            "answer": answer, "evaluation": e.text, "score": sc,
        })
        if sc is not None and sc >= int(threshold):
            break
    return {
        "pattern": "refine", "task": task, "generator": gen, "evaluator": ev,
        "threshold": int(threshold), "rounds": rounds, "final": answer,
        "final_score": rounds[-1]["score"] if rounds else None,
    }
