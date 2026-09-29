"""Blind Ballot — the sharpened voting protocol.

Three fixes over naive multi-agent voting: (1) proposals are BLIND (no anchoring
on the first speaker); (2) proposals are ANONYMIZED before voting (models can't
favor their own style); (3) each voter casts up to 2 approval votes and is
structurally barred from voting for its own option (anti-self-vote). Votes cite a
reason; ties are broken by the verification GATE (run the top candidates), not by
another opinion.
"""
from __future__ import annotations

from .adapter import dispatch, panel, returning
from .gate import run_gate
from .modifiers import anonymize, parse_votes, tally


def run(task, providers=None, gate_cmd=None, cwd=None, timeout=None):
    proposals = panel(
        f"TASK:\n{task}\n\nPropose your single best approach/answer. Be concrete and complete. "
        f"You are answering blind, in parallel — do not reference or imagine the others.",
        providers=providers, timeout=timeout,
    )
    ret = returning(proposals)
    if len(ret) < 2:
        return {"pattern": "ballot", "task": task, "error": "need >=2 proposals to vote",
                "panel": [r.provider for r in proposals]}

    blocks, label_to = anonymize(proposals)
    labels = list(label_to)
    prov_to_label = {v: k for k, v in label_to.items()}

    vote_prompt = (
        f"TASK:\n{task}\n\nAnonymized candidate approaches:\n{blocks}\n\n"
        "Vote for the TWO best. You may not know which is yours — judge on merit. For each, "
        "write one line 'VOTE: Candidate X — <one-line reason>'. Then a line "
        "'CONFIDENCE: <0-1>'. Vote for exactly two distinct candidates."
    )
    ballots, vote_texts = {}, {}
    for r in ret:
        v = dispatch(r.provider, vote_prompt, timeout=timeout)
        vote_texts[r.provider] = v.text
        ballots[r.provider] = parse_votes(v.text, labels)

    own = {r.provider: prov_to_label.get(r.provider) for r in ret}
    ranking = tally(ballots, own_label_by_voter=own, max_votes=2)

    winner_label, tiebreak = None, None
    if ranking:
        top_count = ranking[0][1]
        tied = [l for l, c in ranking if c == top_count]
        if len(tied) > 1 and gate_cmd:
            tiebreak = {"tied": tied, "gate": run_gate(gate_cmd, cwd=cwd)}
            winner_label = tied[0]
        else:
            winner_label = ranking[0][0]

    winner_provider = label_to.get(winner_label)
    winning_text = next((r.text for r in ret if r.provider == winner_provider), None)
    return {
        "pattern": "ballot", "task": task, "panel": [r.provider for r in ret],
        "label_map": label_to, "ballots": ballots, "vote_texts": vote_texts,
        "ranking": ranking, "winner_label": winner_label,
        "winner_provider": winner_provider, "winning_proposal": winning_text,
        "tiebreak": tiebreak,
    }
