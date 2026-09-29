"""Product branding strings and dashboard rebrand helpers."""

from __future__ import annotations

PRODUCT = "Codefusion"
TAGLINE = "Meta LOOP: GPT-5.6 orchestrates · Fable 5 advises · cheap labor executes."
ORCHESTRATOR = "gpt-5.6"
HOST_ADAPTER = "codex"
ADVISOR = "Fable 5"

# UI chrome for the live board (replaces Puppetmaster cost-first framing).
DASHBOARD_TITLE = "Codefusion Board"
DASHBOARD_SUBTITLE = "Meta LOOP · Orchestrator GPT-5.6 · Advisor Fable 5 · parallel labor"

REPLACEMENTS = (
    ("Puppetmaster", PRODUCT),
    ("puppetmaster", "codefusion"),
    ("PUPPETMASTER", "CODEFUSION"),
    ("cost routing", "capability routing"),
    ("Cost routing", "Capability routing"),
    ("cheapest model", "best-fit agent"),
    ("cheapest sufficient model", "best-fit agent for the task"),
)


def rebrand_text(text: str) -> str:
    out = text
    for old, new in REPLACEMENTS:
        out = out.replace(old, new)
    return out
