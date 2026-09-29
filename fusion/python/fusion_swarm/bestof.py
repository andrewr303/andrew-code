"""Self-MoA-Seq — best-of-N from a single strong provider, folded via a rolling
champion with a sliding window. Ported from swarms.structs.self_moa_seq.

Sample one provider N times (in-model diversity), then fold the samples into a
single answer a few at a time, always carrying the current best forward so the
context stays bounded and quality only ratchets up. Useful when you want one
model's best possible answer (a hardened `solo`), or when only one CLI is live.
"""
from __future__ import annotations

from .adapter import dispatch

_FOLD = (
    "You are aggregating multiple candidate answers to the same task. One is marked CURRENT BEST "
    "(synthesized from previous iterations) — anchor on its quality and only change it where a new "
    "candidate is clearly better, more correct, or more complete. Produce a single improved answer."
)


def run(task, provider="codex", samples=5, window=3, reserved=1, max_loops=10, timeout=None):
    samples, window, reserved, max_loops = int(samples), int(window), int(reserved), int(max_loops)
    cands = []
    for i in range(samples):
        r = dispatch(provider, f"Task: {task}\n\nGive your best, complete answer. (attempt {i+1})", timeout=timeout)
        if r.ok and r.text.strip():
            cands.append(r.text)
    if not cands:
        return {"pattern": "bestof", "provider": provider, "task": task,
                "samples": samples, "final": None, "ok": False}

    best = cands[0]
    remaining = cands[1:]
    new_k = max(1, window - reserved)
    folds = []
    loops = 0
    while remaining and loops < max_loops:
        take = remaining[:new_k]
        remaining = remaining[new_k:]
        block = (
            "CURRENT BEST (synthesized from previous iterations):\n" + best + "\n\n"
            + "\n\n".join(f"Candidate {i+1}:\n{c}" for i, c in enumerate(take))
        )
        out = dispatch(provider, f"{_FOLD}\n\nTask: {task}\n\n{block}\n\nImproved single answer:", timeout=timeout)
        if out.ok and out.text.strip():
            best = out.text
        folds.append({"loop": loops + 1, "consumed": len(take), "remaining": len(remaining)})
        loops += 1
    return {
        "pattern": "bestof", "provider": provider, "task": task,
        "samples": len(cands), "folds": folds, "final": best, "ok": True,
    }
