"""Shared synthesis helpers for the Fusion swarm patterns.

When a pattern runs standalone (no Codex conductor in the loop), it needs an
LLM to aggregate — Fusion uses a designated CLI panelist as the aggregator,
with the same consensus/contradictions/blind-spots rubric the Codex judge uses.
When invoked from the Fusion skill, the pattern can instead emit the raw
transcript (`aggregator="none"`) and let Codex do the final synthesis.
"""
from __future__ import annotations

from .adapter import Reply, dispatch, returning

# Mirrors Fusion's Track-B judge rubric (and Swarms' AGGREGATOR_SYSTEM_PROMPT).
AGGREGATOR_PROMPT = (
    "You are the synthesizer for a panel of independent AI models that each "
    "answered the same task. Identify consensus (points most agree on — higher "
    "confidence), contradictions, partial coverage, unique insights, and blind "
    "spots none addressed. Then write a single best answer grounded in that "
    "analysis. Lead with the answer; be concise; cut hedging, redundancy, and "
    "filler. Never exceed the evidence — flag anything unverifiable. Do not "
    "mention the panel or that multiple answers existed."
)


def labeled_blocks(replies: list[Reply], anonymize: bool = False) -> str:
    blocks = []
    for i, r in enumerate(returning(replies)):
        label = f"Member {chr(65 + i)}" if anonymize else r.provider
        blocks.append(f"### {label}\n{r.text}\n")
    return "\n".join(blocks) if blocks else "(no panelist returned a usable answer)"


def cli_synthesize(
    task: str,
    replies: list[Reply],
    aggregator: str = "codex",
    model: str = "",
    effort: str = "",
    instruction: str = "",
) -> Reply:
    """Synthesize `replies` into one answer using a designated CLI aggregator."""
    blocks = labeled_blocks(replies)
    extra = f"\n\n{instruction}" if instruction else ""
    prompt = (
        f"{AGGREGATOR_PROMPT}{extra}\n\n"
        f"ORIGINAL TASK:\n{task}\n\n"
        f"INDEPENDENT ANSWERS:\n{blocks}\n\n"
        f"Write the single best synthesized answer now."
    )
    return dispatch(aggregator, prompt, model=model, effort=effort)


def pick_aggregator(providers: list[str], prefer: str = "codex") -> str:
    """Choose an aggregator CLI: the preferred one if live, else the first live."""
    live = [p for p in providers if p]
    if prefer in live:
        return prefer
    return live[0] if live else prefer
