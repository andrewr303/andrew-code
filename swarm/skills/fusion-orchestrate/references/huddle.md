# The scoping huddle — letting the models analyze the task together

Fusion's defining move is that it does **not** commit to a workflow up front. For tasks
where the right approach isn't obvious, the panel itself helps decide. That's the huddle:
before any mode is chosen, the models look at the task *together* and advise on how to
attack it — then the conductor (you) reads their collective framing and picks.

This is the literal realization of "the models analyze the task together and determine the
best way to move forward, whether that be a discussion, models working in parallel, or
something else."

## When to huddle
- The task is **large, ambiguous, or unfamiliar** and mis-framing it would be expensive.
- You're **unsure which mode fits** (e.g., is this one panel question, or three parallel
  subtasks, or a genuine debate?).
- The user explicitly asks to "figure out the approach first" or runs `/fusion:huddle`.

Skip it for clear tasks — a huddle on an obvious question just burns a round.

## Mechanic
```
fusion.sh huddle "$TASK_FILE" "$OUT_DIR"
```
This dispatches an **approach-only** meta-prompt to the panel (each model answers blind, in
parallel): "How would you frame/decompose this? Which collaboration style fits — panel,
debate, council, swarm, or is one model enough? What's the biggest risk?" Crucially it tells
them **not to solve the task yet** — just to advise on attack.

Then **you read the panel's framings** and decide:
- If they converge on a decomposition → run `swarm` with that decomposition.
- If they surface a real two-sided tension → run `debate`.
- If they flag high stakes + disagreement on the answer → run `council`.
- If they agree it's straightforward → run a single `panel` (or even `solo`).
- If they disagree on *approach itself*, that disagreement is signal — weigh it.

The huddle's output is **advice you synthesize**, exactly like any panel — absent panelists
don't get a vote, and you remain the decider. It just means the mode choice is informed by
the panel's collective read of the task, not yours alone.

## Cost
One extra short panel round (cheap — the meta-prompt asks for ≤120 words and no solving).
Worth it when mis-framing a big task would cost far more than one round. Record the huddle as
part of the run (note `huddle:true` in the run record) so the ledger learns when huddling
paid off.
