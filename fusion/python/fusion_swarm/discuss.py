"""GroupChat-style discussion over the panel.

Ported (and adapted for heterogeneous CLIs) from swarms.structs.GroupChat. The
panel holds a shared, multi-round discussion: each round, every live panelist
sees the running transcript and adds one focused contribution (building on or
challenging others), then a synthesis. Unlike `panel` (blind), this is a
collaborative brainstorm where ideas compound.

Note: within a round panelists answer in parallel (blind to that round's peers)
but see all *prior* rounds — true async self-selection needs uniform tool-calling
the CLIs don't share, so this is the tractable, honest port.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from .adapter import Reply, available, dispatch
from .synth import cli_synthesize, pick_aggregator


def run(task, providers=None, rounds=2, aggregator="codex", timeout=None):
    provs = providers or available()
    transcript = []

    def thread_str():
        if not transcript:
            return "(no messages yet — you are opening the discussion)"
        return "\n\n".join(f"[{m['speaker']}]: {m['text']}" for m in transcript)

    for rnd in range(1, int(rounds) + 1):
        snapshot = thread_str()
        with ThreadPoolExecutor(max_workers=max(1, len(provs))) as ex:
            futs = {
                ex.submit(
                    dispatch,
                    a,
                    f"You are '{a}' in a group discussion working toward the best answer to:\n"
                    f"{task}\n\nDiscussion so far:\n{snapshot}\n\n"
                    f"Add ONE focused contribution (<120 words): build on or challenge specific "
                    f"points, add something new, or correct an error — don't just repeat.",
                    timeout=timeout,
                ): a
                for a in provs
            }
            res = {futs[f]: f.result() for f in futs}
        for a in provs:
            r = res[a]
            if r.ok and r.text.strip():
                transcript.append({"round": rnd, "speaker": a, "text": r.text})

    result = {
        "pattern": "discuss",
        "task": task,
        "rounds": int(rounds),
        "panel": provs,
        "transcript": transcript,
    }
    if aggregator and aggregator != "none":
        agg = pick_aggregator(provs, aggregator)
        msgs = [Reply(m["speaker"], m["text"], "returned", True) for m in transcript]
        syn = cli_synthesize(
            task, msgs, aggregator=agg,
            instruction=(
                "The above are turns from a multi-round group discussion. Synthesize the "
                "discussion into one best answer, resolving disagreements with reasoning."
            ),
        )
        result["aggregator"] = agg
        result["synthesis"] = syn.text if syn.ok else None
        result["synthesis_ok"] = syn.ok
    return result
