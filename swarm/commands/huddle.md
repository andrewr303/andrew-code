---
description: Scoping huddle — the panel analyzes the task together and advises on approach (panel/debate/council/swarm/solo) before Claude commits to a mode. For large, ambiguous, or unfamiliar tasks.
argument-hint: <task to scope before deciding how to attack it>
---

Invoke the **fusion-orchestrate** skill and run a **scoping huddle** before choosing a mode,
on the task below:

$ARGUMENTS

Write the task to a file, then `fusion.sh huddle "$TASK_FILE" "$OUT_DIR"` — the panel advises
on APPROACH only (how to frame/decompose, which collaboration style fits, the biggest risk),
without solving it yet. Read their collective framing per `references/huddle.md`, then pick
the mode (swarm / debate / council / panel / solo) it points to and proceed with that mode's
mechanic. Record the run with `huddle:true`.
