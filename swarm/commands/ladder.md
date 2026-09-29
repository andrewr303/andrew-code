---
description: Escalation Ladder — cheapest model first; a gate failure (or low confidence) escalates to a stronger, costlier model with the failure log attached. Spend the minimum; only hard cases reach the flagship.
argument-hint: <task> [--gate-cmd "<verify cmd>"] [--cwd <dir>] [--confidence 0.7]
---

Invoke the **fusion-swarms** skill and run the Escalation Ladder on:

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh ladder "<task>" [--gate-cmd "<verify>"] [--cwd <dir>] --json`.
Tier 1 (cheap: opencode/glm) attempts first; if a `--gate-cmd` is given the gate decides and
its log travels up to the next tier (mid → strong codex). Without a gate it escalates on
self-reported confidence below `--confidence`. Present the final answer + which tier cleared
it (the escalation count is the cost signal), and record the run (`task_type: swarm:ladder`).
Best for high-volume routine work where most tasks are easy.
