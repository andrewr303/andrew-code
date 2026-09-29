---
description: Agent-level reasoning wrappers that harden a single panelist — reflexion (draft→self-critique→revise), self-consistency (sample N, majority), or GKP (generate knowledge, then answer).
argument-hint: <task> [--style reflexion|selfconsist|gkp] [--provider codex|copilot|opencode|grok]
---

Invoke the **fusion-swarms** skill and apply a reasoning wrapper to one panelist on:

$ARGUMENTS

Pick the style (default `reflexion`) and provider (default `codex`), then run one of:
- `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh reflexion "<task>" --provider <p> --iterations 2 --json`
- `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh selfconsist "<task>" --provider <p> --samples 5 --json`
- `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh gkp "<task>" --provider <p> --json`

These operate on ONE provider. Read the final/steps, present the hardened answer + a short
trail (style, provider, iterations/agreement), and record the run (`task_type: swarm:<style>`).
Compose them: a reflexion-hardened panelist makes a strong member of a larger `panel`/`moa`.
