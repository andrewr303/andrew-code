---
description: Group-chat brainstorm — the panel holds a multi-round shared-thread discussion where ideas compound, then Claude synthesizes. Use when collaboration should build on itself (not blind parallel).
argument-hint: <task or question to brainstorm> [--rounds N]
---

Invoke the **fusion-swarms** skill and run the discussion pattern on:

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh discuss "<task>" --rounds <N|2> --json`.
Each round, every panelist sees the running transcript and adds one contribution. Read the
thread, synthesize the discussion into one best answer (resolving disagreements with
reasoning), present with the audit trail, and record the run (`task_type: swarm:discuss`).
