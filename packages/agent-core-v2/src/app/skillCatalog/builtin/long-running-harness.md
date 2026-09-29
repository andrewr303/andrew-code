---
name: long-running-harness
description: >-
  Long-running agent harness: Default-FAIL contracts, PROGRESS.md handoffs,
  fresh-context evaluator subagent, one-feature-per-session discipline.
  From Anthropic cwc-long-running-agents patterns. Triggers: long-running,
  multi-session, progress.md, default-fail, evaluator, harness.
---

# Long-running agent harness (native AndrewCode)

Patterns from Anthropic's long-running agent harness, integrated with AndrewCode's
subagents (`plan` · `explore` · `coder` · `evaluator`) and optional Fusion panels.

## The three primitives

### 1. Default-FAIL contract
Every success criterion starts **false**. The agent cannot mark it passing without
evidence (opened screenshots, logs, failing→passing tests). Prefer a project file:

```json
{ "feature-1": { "passes": false }, "feature-2": { "passes": false } }
```

Never grade your own homework as done without proof.

### 2. Fresh-context evaluator
After a `coder` claims a feature is complete, spawn **`subagent_type: evaluator`**.
It has no Write/Edit tools. It returns:

```
PASS
<one line of evidence>
```

or

```
NEEDS_WORK
- specific fixable findings…
```

On `NEEDS_WORK`, the findings become the next builder prompt. Do not let the builder
re-evaluate itself in the same context.

### 3. Agent-maintained handoff (`PROGRESS.md`)
At session start: **read `PROGRESS.md` first** (create with `## Done`, `## In progress`,
`## Next`, `## Notes` if missing). Work **one feature per session**. Update PROGRESS.md
after each checkpoint. Commit at meaningful points when the user allows git mutations.

## Recommended loop

1. `plan` — break the goal into features; write/refresh PROGRESS.md
2. `explore` — research only what the next feature needs
3. `coder` — implement exactly one unfinished feature; run tests; capture evidence
4. `evaluator` — independent PASS / NEEDS_WORK
5. On PASS, update the Default-FAIL contract + PROGRESS.md; on NEEDS_WORK, resume coder
6. Optional: `Fusion` panel for plan audit or implementation review across model families

## Mapping to Anthropic harness roles

| Harness role | AndrewCode |
|--------------|------------|
| Initializer / planner | `plan` subagent (+ main agent) |
| Coding agent | `coder` subagent |
| Fresh evaluator | `evaluator` subagent |
| Multi-model review | `Fusion` tool |
| Parallel workers | `AgentSwarm` |

## Operator stop
If the user says stop, or an `AGENT_STOP` / steering note appears, halt autonomous
progress and surface status.
