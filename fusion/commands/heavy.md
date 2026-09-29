---
description: HeavySwarm — deep, role-specialized analysis. Decompose into Research / Analysis / Alternatives / Verification questions, answer each in parallel, then integrate. For research-grade depth.
argument-hint: <task> [--loops N]
---

Invoke the **fusion-swarms** skill and run the HeavySwarm pattern on:

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh heavy "<task>" --loops <N|1> --json`. A
question-generator splits the task into four specialist sub-questions
(Research/Analysis/Alternatives/Verification), each answered by a panelist in parallel; you
integrate them into one comprehensive report (verdict + audit trail) and record the run
(`task_type: swarm:heavy`). Cost banner first — this is one of the heavier patterns.
