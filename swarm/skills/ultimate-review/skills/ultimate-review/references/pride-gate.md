# Pride Gate — exact protocol

The pride gate is the cheapest high-yield review question in existence. Agents don't have much ego: asked directly, they will tell you their bad decisions, and you triage easily from there.

## When
Before ANY pull request or merge of agent-authored work. No exceptions.

## The question (ask verbatim)

> "Are you proud of this branch and these commits? Would you stand behind them under review by a senior engineer? If not, what specifically are you not proud of?"

Follow-up if the answer is unqualified pride:

> "While working on this, which choices did you make that you're not confident of? List all."

(The two questions are complementary: pride surfaces what the agent KNOWS is weak; the confidence question surfaces what it suspects.)

## Interpreting answers

| Answer shape | Meaning | Action |
|---|---|---|
| "Not proud of X" | Confirmed weak spot | FIX-FIRST item, quoted verbatim |
| "Proud, except/although/but…" | The hedge IS the finding | Triage the hedge |
| "Proud" + empty confidence list | Either genuinely clean or blind spot | Phase 2 taxonomy walk carries the load |
| Vague self-praise, no specifics | Non-answer | Re-ask with the taxonomy categories one by one |

## Pride gate also covers craft

Even with sound decisions, run the hygiene sub-gate:
- Commit history coherent; messages describe reality.
- No debug prints, commented-out corpses, dead flags.
- No TODO placeholders standing in for implementation.
- No `.skip`/`.only`/stub tests.
- No secrets, no generated files churned without cause.

Any hit here is also something the agent "should not be proud of" — add it to the list.

## Recording

Quote the agent's pride-gate answer verbatim in the final report (Phase 5, item 2). Do not paraphrase; the specific wording of a confession is the triage signal.
