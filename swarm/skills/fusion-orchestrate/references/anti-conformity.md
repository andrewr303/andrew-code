# Anti-conformity — keeping a council from collapsing into agreement

Naive multi-model deliberation has a well-documented failure mode: once panelists see each
other, they **converge** — not because anyone was persuaded, but because agreement is
socially/statistically attractive. A council that collapses to consensus has thrown away
the exact thing you paid for. Two cheap, load-bearing defenses, used in `council` and
`debate` rounds only:

## 1. Anonymize peers before showing them
When you re-dispatch a round that includes other panelists' answers:
- Relabel each prior answer **Member A / B / C / D** in a stable order.
- **Strip self-attribution** — no model names, no "as the GPT model said".
- Keep the label→provider map **yourself** (the orchestrator); restore it only for your own
  synthesis. Panelists deliberate against *arguments*, not *brands* — a model can't favor
  "Codex" or itself by name if it doesn't know which is which.

## 2. The name-the-flaw directive (append verbatim to every cross-examination round)

> **Anti-conformity directive.** If your earlier position was correct, defend it. Do not
> update merely because peers disagree, because a consensus is forming, or because a point
> is repeated by several members. Update only when a peer's reasoning exposes a *specific*
> flaw in your earlier argument. Naming that specific flaw is **required** when you update;
> if you cannot name it, you should not update. Engage at least two other members by their
> labels, and say plainly where they are wrong, not only where they are right.

The load-bearing clause is **"name the flaw before you update."** It converts "I'll agree
to fit in" into "I'll change only for a reason I can state" — which is exactly the behavior
that keeps minority-but-correct positions alive.

## Enforcement (you, the orchestrator)
- **Dissent quota:** a healthy R2 surfaces ≥2 distinct, non-overlapping objections across
  the panel. If everyone just agrees, that's a smell — force a counterfactual round.
- **Counterfactual on high agreement:** if >~70% of panelists align after R1, before you
  synthesize, ask the strongest one or two dissenters (or construct the steel-man yourself):
  "What would have to be true for the majority to be wrong here?" Surface their answer.
- **Minority report:** if a panelist holds a reasoned dissent into R3, the verdict carries a
  one-line **Minority Report** — do not bury it. The 1-in-5 case where the crowd is wrong is
  the entire reason you ran a council.
- **No forced consensus:** if there's genuinely no majority, present the live dilemma with
  its cruxes. Don't manufacture agreement to look decisive.
