---
description: Manage the agency context — shared state across tools and agents within a Fusion session. View, set, or clear context entries.
argument-hint: <action> [key] [value]
---

Invoke the **fusion-agency-context** skill with the given action on `$ARGUMENTS`.

Supported actions:
- `get <key>` — read a value from the shared agency context
- `set <key> <value>` — store a value that other tools/agents can read
- `list` — show all keys currently in the context
- `clear` — drop the entire context (use at session end)
- `snapshot` — export the full context as JSON for persistence

Agency context eliminates the need for explicit parameter passing between
tools — Tool A can store data with `.set()` and Tool B can retrieve it with
`.get()`, saving tokens and simplifying multi-step workflows.
