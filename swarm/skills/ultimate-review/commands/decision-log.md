---
description: Start (or append to) the during-work decision log at .ultimate-review/decisions.md so low-confidence choices are catalogued as they happen.
argument-hint: [task description, optional]
---

Set up the during-work protocol from the **ultimate-review** skill for the current task ($ARGUMENTS if given).

1. Create `.ultimate-review/decisions.md` from templates/decision-log.md if it does not exist (task line, agent, branch, timestamp).
2. From now on in this session, append an entry AT THE MOMENT you make any decision you are not completely confident in, plus all critical-category decisions (auth, money, migration, concurrency, memory layout, public API, security) even at high confidence: decision, alternatives, why, confidence, origin, blast radius.
3. Append every declared success to the Success claims table with its evidence and grade.
4. Entries are append-only; corrections reference the entry they reverse.

Confirm the log path and show the header once created, then continue with the task.
