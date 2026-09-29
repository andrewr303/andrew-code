---
description: Decompose a large/parallelizable task and execute in parallel. For large multi-file coding work, prefer hive nested-hive (architect + captains + real andrewcode children on one Hive Board); classic flat swarm remains available.
argument-hint: <large task, e.g. "migrate all logger calls across the repo">
---

Invoke the **fusion-swarm** skill on:

$ARGUMENTS

**Shape first.** For large multi-file coding work, recommend **`hive` / `nested-hive`**
(architect designs a SwarmSpec; captains spawn real andrewcode children; Communication =
Hive Board). Classic `mode = swarm` (flat decompose → route → waves) is still allowed
when the split is already independent and nesting would be overkill.

Classic swarm: decompose into independent subtasks with dependencies. Route each to its
best fit (codex→code, copilot→breadth, opencode→volume, grok→realtime, andrewcode→nested
implementation, you→glue/repo-context), breaking ties with `lessons.md`. Execute
independent subtasks in parallel waves; dependent ones wait.

Hive nested-hive: `python -m fusion_swarm.hive` (or `--dry-run` to build the tree + board
without subprocesses). Workers talk on the board, never to the human. Real dispatch only;
absent ≠ agreement.

**Estimate cost and confirm with the user before a large fan-out.** Assemble and
**run/verify** the combined deliverable end to end. Record the run with per-subtask routing.
