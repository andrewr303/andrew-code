---
description: Inspect and curate what Fusion has learned — reliability, who-wins-by-task, best mode per task type — and regenerate the lessons the Conductor reads before routing.
argument-hint: [stats | leaderboard [task] | winners <task> | lessons | feedback <run> shipped|rejected]
---

Invoke the **fusion-learn** skill.

Args: $ARGUMENTS

Default (no args): show `fusion.sh ledger stats`, the overall leaderboard, and a plain-language
read of who's pulling their weight and which modes dominate. For `lessons`, regenerate
`memory/lessons.md`. For `feedback`, record the user's ground-truth outcome on a past run.
Keep the ranks honest — this is the signal that makes the next run smarter.
