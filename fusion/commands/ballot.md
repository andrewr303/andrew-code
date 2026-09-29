---
description: Blind Ballot — panelists propose blind, proposals are anonymized, each votes for 2 (barred from voting for its own), votes cite reasons, and ties break on the verification gate. Group-think-proof decision-making.
argument-hint: <decision/question> [--gate-cmd "<verify>"] [--cwd <dir>]
---

Invoke the **fusion-swarms** skill and run the Blind Ballot on:

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh ballot "<task>" [--gate-cmd "<verify>"] [--cwd <dir>] --json`.
Proposals are blind then anonymized (Candidate A/B/C); each voter casts up to two approval
votes and is structurally barred from voting for its own option (anti-self-vote); ties break
by running the top candidates through the gate, not another opinion. Present the winner + the
ranking + why, and record the run (`task_type: swarm:ballot`). Best for "which approach"
decisions, API design, refactor strategy.
