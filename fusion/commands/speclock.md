---
description: Spec-Locked Parallel Cells — write a hard contract (types + signatures + test stubs) first, then fan out modules in parallel against it; a build/typecheck gate is the integrator. Makes parallel agents actually scale on a codebase.
argument-hint: <task> [--contract-author codex] [--gate-cmd "<build/typecheck>"] [--cwd <dir>]
---

Invoke the **fusion-swarms** skill and run Spec-Locked Parallel Cells on:

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh speclock "<task>" --contract-author <P|codex> [--gate-cmd "<build/typecheck>"] [--cwd <dir>] --json`.
The contract author writes the types/signatures/stubs first; implementers each build one
module against that shared contract in parallel; the gate (typecheck/build) integrates — if
it's green the pieces fit by construction, and only a failing module needs escalation. Review
the contract before the fan-out (a bad contract poisons everything). Present the integrated
result + gate status, and record the run (`task_type: swarm:speclock`). Best for features
that decompose into modules with clean seams.
