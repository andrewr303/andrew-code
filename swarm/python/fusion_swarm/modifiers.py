"""Reusable swarm modifiers (mix-ins). Building these once multiplies the catalog —
every structure opts in instead of re-implementing them.

  - anonymize         strip model identity before cross-review/vote
  - parse_votes       extract voted candidate labels from free text
  - tally             count votes WITH anti-self-vote enforced
  - parse_confidence  pull a 0-1 confidence stake out of free text
  - decision_baton    a structured handoff payload (decisions/assumptions/risks)
"""
from __future__ import annotations

import re
from collections import Counter

from .adapter import Reply, returning


def anonymize(replies: list[Reply]):
    """Return (blocks_str, label_to_provider). Stable 'Candidate A/B/C' labels over
    the panelists that actually returned (absent != a candidate)."""
    ret = returning(replies)
    label_to = {}
    blocks = []
    for i, r in enumerate(ret):
        lbl = f"Candidate {chr(65 + i)}"
        label_to[lbl] = r.provider
        blocks.append(f"### {lbl}\n{r.text}\n")
    return "\n".join(blocks), label_to


def parse_votes(text: str, labels: list[str]) -> list[str]:
    """Extract voted candidate labels (e.g. 'Candidate A'), in order of appearance."""
    seen, ordered = set(), []
    for m in re.finditer(r"Candidate [A-Z]", text or ""):
        l = m.group(0)
        if l in labels and l not in seen:
            seen.add(l)
            ordered.append(l)
    return ordered


def tally(ballots: dict, own_label_by_voter: dict | None = None, max_votes: int = 2):
    """ballots: voter -> [labels]. Strips each voter's own option (anti-self-vote),
    caps at max_votes, returns [(label, count)] sorted desc."""
    own = own_label_by_voter or {}
    c = Counter()
    for voter, votes in ballots.items():
        kept = [l for l in votes if l != own.get(voter)][:max_votes]
        for l in kept:
            c[l] += 1
    return c.most_common()


def parse_confidence(text: str):
    """Pull a confidence stake in [0,1] out of free text. Looks for 'CONFIDENCE: x'
    or a trailing percentage."""
    if not text:
        return None
    m = re.search(r"CONFIDENCE:\s*(0?\.\d+|1(?:\.0+)?|\d{1,3})\s*%?", text, re.I)
    if m:
        try:
            f = float(m.group(1))
            return max(0.0, min(1.0, f / 100 if f > 1 else f))
        except ValueError:
            return None
    m = re.search(r"\b(\d{1,3})\s*%", text)
    if m:
        return max(0.0, min(1.0, int(m.group(1)) / 100))
    return None


def decision_baton(role_from, role_to, decisions, assumptions, open_questions, risks):
    """A structured handoff payload so reviewers can audit where context was lost,
    not just the final artifact."""
    def lst(x):
        return "\n".join(f"- {i}" for i in x) if x else "- (none)"
    return (
        f"## Decision Baton: {role_from} → {role_to}\n"
        f"### Decisions made\n{lst(decisions)}\n"
        f"### Assumptions\n{lst(assumptions)}\n"
        f"### Open questions\n{lst(open_questions)}\n"
        f"### Risks\n{lst(risks)}\n"
    )
