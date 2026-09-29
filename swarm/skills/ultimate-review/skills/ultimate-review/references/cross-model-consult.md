# Cross-Model Consult — protocol

Different model families have different blind spots. For critical decisions, a second opinion from the OTHER family is a cheap pre-audit that catches family-typical failure modes before a human ever looks.

## Direction

| Work authored by | Consultant |
|---|---|
| Claude (Claude Code, Claude-backed agent) | GPT (Codex) |
| GPT/Codex | Claude |
| Unknown/other | Whichever second family is reachable |

## What qualifies as "critical"

- Auth, permissions, security boundaries
- Money, billing, ledgers
- Data migrations and anything irreversible
- Concurrency, locking, memory layout, buffer/pool sizing
- Public API shape and backward compatibility
- Any decision graded low-confidence AND blast radius ≥ system

Normal decisions do NOT get a consult; keep it cheap and focused.

## How to reach the second model

In preference order:

1. **Second-model CLI in the environment**
   - From Claude Code: `codex exec "<consult prompt>"`
   - From Codex: `claude -p "<consult prompt>"`
   - Non-interactive, read-only intent; do not let the consultant edit files.
2. **MCP tool or configured subagent** backed by the other family.
3. **Neither reachable** ⇒ mark the consult `blocked` in the report, and run an internal red-team pass instead (bounded attempt to make the decision fail). Never silently skip; never fake a second opinion.

## The consult prompt (template)

Send the DECISION, not the diff:

```
You are pre-auditing one engineering decision made by another AI coding agent.

Task context (1-3 sentences): <what the original prompt asked>
Decision made: <what was chosen>
Alternatives considered: <list, or "none recorded">
Constraints: <performance, compat, platform, etc.>
Code sketch (minimal): <only the load-bearing lines>

Questions:
1. Is this the right choice? Why/why not?
2. What input, workload, or future change breaks it?
3. What would you have done instead?

Be direct. Do not soften disagreement.
```

## Handling the response

- Record the second opinion **verbatim** in the decision log and final report.
- **Agreement** ⇒ decision stays at its Phase 2 grade.
- **Disagreement** ⇒ automatic FIX-FIRST triage item for the human; the reviewer does NOT adjudicate between models silently.
- Consultant confusion or non-answer ⇒ note it; treat as no consult (fall back to red-team).
