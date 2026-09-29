---
description: Decompose a large/parallelizable task, route each subtask to the best-suited CLI, execute in dependency waves in parallel, then synthesize and verify one deliverable.
argument-hint: <large task, e.g. "migrate all logger calls across the repo">
---

Invoke the **fusion-swarm** skill and run the Conductor with `mode = swarm` on:

$ARGUMENTS

Decompose into independent subtasks with dependencies. Route each to its best fit
(codex→code, copilot→breadth, opencode→volume, grok→realtime, you→glue/repo-context),
breaking ties with `lessons.md`. Execute independent subtasks in parallel waves; dependent
ones wait. **Estimate cost and confirm with the user before a large fan-out.** Assemble and
**run/verify** the combined deliverable end to end. Record the run with per-subtask routing.
