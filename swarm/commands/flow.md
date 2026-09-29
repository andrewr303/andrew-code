---
description: Flow DSL — a custom sequential/parallel pipeline over the providers. "codex -> copilot, opencode -> grok" means codex, then copilot+opencode in parallel, then grok.
argument-hint: <task> --flow "codex -> copilot, opencode -> grok"
---

Invoke the **fusion-swarms** skill and run the flow pattern on:

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh flow "<task>" --flow "<dsl>" --json`. Tokens
are provider names (codex/copilot/opencode/grok); `->` is sequential, `,` is parallel within
a stage, and each stage's output feeds the next. Read the final stage output, synthesize +
present with the audit trail, and record the run (`task_type: swarm:flow`).
