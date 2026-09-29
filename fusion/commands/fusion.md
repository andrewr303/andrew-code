---
description: Fusion — orchestrate multiple frontier CLIs to beat one model. Claude picks the collaboration mode dynamically (solo/panel/council/debate/vote/swarm), dispatches the live panel, judges, synthesizes, and learns.
argument-hint: <task or question> [--mode panel|council|debate|vote|swarm|solo] [--huddle]
---

Invoke the **fusion-orchestrate** skill (the Conductor) and run its full dynamic procedure
on the task below.

Task: $ARGUMENTS

Rules of engagement:
- This is the **dynamic** entry: read the task, run `fusion.sh route`, read `lessons.md`,
  and **choose** the best collaboration mode — do not default to a rigid pipeline. If the
  user passed `--mode`, honor it. If they passed `--huddle`, run a scoping huddle first.
- Show the cost banner before dispatching paid CLIs. Actually dispatch the panel (no
  simulation). Mark non-returning panelists absent.
- Judge with the right track (run-the-code for code, five-section synthesis for research).
- Present the answer in Fusion's voice + the audit trail (mode, panel, consensus, cost, and
  for decisions: kill criteria + one next step).
- Record the run with `fusion.sh ledger record` so Fusion compounds.
