---
description: Iterative quality gate — a generator panelist answers, an evaluator scores it 0-100 with feedback, and it's revised until it clears a threshold or hits max rounds. A real gate, not "looks good".
argument-hint: <task> [--generator P] [--evaluator P] [--threshold 85] [--rounds 3]
---

Invoke the **fusion-swarms** skill and run the refine (generate→evaluate→gate) pattern on:

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh refine "<task>" --generator <P|codex> --evaluator <P|copilot> --threshold <N|85> --rounds <N|3> --json`.
The generator and evaluator are *different* panelists. Read the rounds + final score, present
the final answer with the score trail, and record the run (`task_type: swarm:refine`). If it
never clears the threshold, say so honestly and present the best round.
