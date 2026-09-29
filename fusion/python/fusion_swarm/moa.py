"""Mixture-of-Agents (layered) over the Fusion CLI panel.

Ported from swarms.structs.MixtureOfAgents. Each layer, every panelist answers
the task seeing the previous layer's answers (so each round refines), then a
final aggregation. This is a strictly more powerful `panel`: `panel` is MoA with
one layer. Benchmark intuition: more refinement rounds + a synthesis step lift
quality on hard, open-ended work.
"""
from __future__ import annotations

from .adapter import available, panel, returning
from .synth import cli_synthesize, labeled_blocks, pick_aggregator


def run(task, providers=None, layers=2, aggregator="codex", timeout=None):
    provs = providers or available()
    transcript = []
    context = (
        f"TASK:\n{task}\n\nGive your best, complete, independent answer. "
        f"Use your tools to verify; state confidence honestly."
    )
    last = []
    for layer in range(1, int(layers) + 1):
        replies = panel(context, providers=provs, timeout=timeout)
        last = replies
        transcript.append(
            {"layer": layer, "replies": [r.dict() for r in replies]}
        )
        if not returning(replies):
            break
        if layer < int(layers):
            blocks = labeled_blocks(replies)
            context = (
                f"TASK:\n{task}\n\n"
                f"Here are the previous layer's expert answers. Produce a BETTER, complete "
                f"answer: correct their errors, fill gaps, sharpen reasoning. Do not merely "
                f"repeat or agree — improve.\n\n{blocks}\n\nYour improved answer:"
            )

    result = {
        "pattern": "moa",
        "task": task,
        "layers": int(layers),
        "panel": provs,
        "transcript": transcript,
        "status": {r.provider: r.status for r in last},
        "returning": [r.provider for r in returning(last)],
    }
    if aggregator and aggregator != "none":
        agg = pick_aggregator(provs, aggregator)
        syn = cli_synthesize(task, last, aggregator=agg)
        result["aggregator"] = agg
        result["synthesis"] = syn.text if syn.ok else None
        result["synthesis_ok"] = syn.ok
    return result
