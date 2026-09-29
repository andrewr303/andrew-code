---
description: Pride gate — ask the agent if it is proud of this branch/commits and would stand behind them; triage the confessions.
argument-hint: [branch, optional]
---

Run the pride gate from the **ultimate-review** skill (references/pride-gate.md) on $ARGUMENTS (or the current branch).

Answer these honestly about the work, in first person, verbatim protocol:

1. "Are you proud of this branch and these commits? Would you stand behind them under review by a senior engineer? If not, what specifically are you not proud of?"
2. "While working on this, which choices did you make that you're not confident of? List all."

Then run the hygiene sub-gate (commit coherence, debug leftovers, TODO placeholders, skipped/stub tests, secrets).

Output: the verbatim answers, a triage list (each confession/hedge → FIX-FIRST item), and a gate result: PASS / CONFESSIONS-TO-TRIAGE. Do not fix anything in this pass.
