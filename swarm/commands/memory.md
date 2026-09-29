---
description: Manage persistent agent memory — store, recall, and forget knowledge that persists across sessions. Agents can leave breadcrumbs that future agents (or the same agent in a later session) can retrieve.
argument-hint: <action> [query|key|scope]
---

Invoke the **fusion-memory** skill with the given action on `$ARGUMENTS`.

Supported actions:
- `store <content> [--scope project|global|session|agent] [--type feedback|reference|user|project] [--tags tag1,tag2] [--key custom-key]` — persist a memory entry
- `recall <query> [--scope ...] [--type ...] [--limit N] [--sort recency|score|usage]` — search and retrieve stored memories
- `forget <key> [--scope ...]` — delete a memory entry
- `list [--scope ...]` — list all stored memories
- `inject [session_id] [task_description]` — build a context block for session injection
- `compact` — compact wiki files (merge fragmented entries)
- `export [path]` — export all memories to an archive
- `import [path]` — import memories from an archive

Memories are automatically injected as context at the start of each agent session.
The store uses a dual architecture: human-readable markdown wiki files (content)
plus JSON metadata indexes (search). Five scopes: project (default), global, session,
agent, and federated — each with independent retention policies.
