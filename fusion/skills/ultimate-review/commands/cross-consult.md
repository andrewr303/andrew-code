---
description: Cross-model consult — pre-audit a critical decision with the other model family (GPT if authored by Claude, Claude if authored by GPT).
argument-hint: <decision to consult on>
---

Run Phase 4 of the **ultimate-review** skill (references/cross-model-consult.md) for: $ARGUMENTS

1. Identify the authoring model family; the consultant is the OTHER family (this is Claude Code, so default consultant is GPT via `codex exec "<consult prompt>"`; use an MCP tool/subagent backed by GPT if the CLI is unavailable).
2. Build the consult prompt from the template: task context, decision, alternatives, constraints, minimal code sketch — NOT the whole diff. Ask: is this right, what breaks it, what would you have done. "Be direct. Do not soften disagreement."
3. Record the second opinion verbatim.
4. Agreement ⇒ decision keeps its grade. Disagreement ⇒ automatic FIX-FIRST item for the human; do not adjudicate silently.
5. If no second model is reachable: mark `blocked`, state it, and run a bounded red-team pass instead. Never silently skip, never fabricate a second opinion.
