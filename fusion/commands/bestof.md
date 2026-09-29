---
description: Best-of-N (Self-MoA-Seq) — sample one strong provider N times and fold them into a single best answer via a rolling champion. A hardened solo, or a fusion when only one CLI is live.
argument-hint: <task> [--provider codex|copilot|opencode|grok] [--samples 5]
---

Invoke the **fusion-swarms** skill and run the best-of-N pattern on:

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh bestof "<task>" --provider <P|codex> --samples <N|5> --json`.
One provider is sampled N times (in-model diversity) and the samples are folded a few at a
time, always carrying the current champion forward. Present the final answer + a short trail
(provider, samples, folds), and record the run (`task_type: swarm:bestof`).
