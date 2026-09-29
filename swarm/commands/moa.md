---
description: Mixture-of-Agents — layered refinement. All panelists answer, see each other's answers, and refine across N layers, then Claude synthesizes. A stronger panel for hard, open-ended work.
argument-hint: <task> [--layers N]
---

Invoke the **fusion-swarms** skill and run the MoA pattern on:

$ARGUMENTS

First ping every CLI runtime live and show the swarm config for this and every other mode:
`bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh roster --json` — reports each provider's tier/
family/harness, its live-discovered model list (cache-first; pass `--force-refresh` to
re-probe), and every `/fusion:<mode>` command's declared roster (parsed from `commands/*.md`,
not hand-maintained). Use this to pick real, currently-available models for `--providers`
before dispatching, and to show the user which panelists are actually live vs absent —
absent is never silently treated as agreement.

Then run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh moa "<task>" --layers <N|2> --json`. The
panelists refine across layers (each layer sees the prior layer's answers). Read the JSON
transcript, then write the final Fusion verdict yourself (you are the judge) with the audit
trail, and record the run (`task_type: swarm:moa`). Show the cost banner first — MoA is
~layers× a panel.

For the full live provider/model dashboard (config editing, per-provider refresh, all-modes
browser) run `/fusion:dashboard` instead of parsing the roster JSON by hand.
