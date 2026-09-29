---
name: fusion-memory
description: >-
  Manage persistent agent memory — store, recall, and forget knowledge that
  survives across Fusion sessions. Agents leave breadcrumbs (preferences,
  discoveries, lessons) that are automatically injected as context at session
  start. Dual-store architecture: markdown wiki (content) + JSON index (search).
  Use for: saving project conventions, recalling past decisions, injecting
  session context, managing agent knowledge bases. Triggers: "memory store",
  "memory recall", "agent memory", "persistent memory", "save for later",
  "remember this", "/fusion:memory", "what do we know about".
---

# Fusion Memory

You manage **persistent agent memory** — a knowledge store that survives
across Fusion sessions. Agents use `memory_store` to write facts, `memory_recall`
to retrieve them, and `memory_forget` to remove stale knowledge.

## Architecture

Memory uses a **dual-store** design:

| Store | What | Where |
|-------|------|-------|
| Markdown wiki files | Human-readable content with timestamped entries | `~/.fusion/memory/{scope}/wiki/{key}.md` |
| JSON metadata index | Searchable metadata for fast queries | `_index.json` alongside wiki files |

Every `memory_store` writes **both** stores; every `memory_recall` reads
**both** stores.

## Scopes (where memory lives)

| Scope | Storage path | Scope ID | Retention |
|-------|-------------|----------|-----------|
| `project` (default) | `memory/{project_id}/wiki/project/` | Git remote hash or CWD hash | 90 days |
| `global` | `memory/global/wiki/global/` | None | Never expires |
| `session` | `memory/global/wiki/session/{name}/` | session_name | 14 days |
| `agent` | `memory/global/wiki/agent/{profile}/` | agent_profile | Never expires |
| `federated` | `memory/federated/wiki/federated/` | None | Never expires |

## Types (classification labels, orthogonal to scope)

`project`, `user`, `feedback`, `reference`

## Slash commands

- `/fusion:memory store <content> [--scope ...] [--type ...] [--tags ...] [--key ...]`
- `/fusion:memory recall <query> [--scope ...] [--type ...] [--limit N] [--sort ...]`
- `/fusion:memory forget <key> [--scope ...]`
- `/fusion:memory list [--scope ...]`
- `/fusion:memory inject [session_id] [task_description]`
- `/fusion:memory export [path]`
- `/fusion:memory import [path]`

## Python API

```python
from fusion_swarm.memory_service import memory_store, memory_recall, memory_forget, inject_memory_context

# Store a fact
memory_store(
    content="Always use pytest for testing. Fixtures go in conftest.py.",
    scope="project",
    memory_type="feedback",
    tags="testing,pytest,conventions",
)

# Recall relevant memories
results = memory_recall(
    query="testing",
    scope="project",
    memory_type="feedback",
    limit=5,
    sort_by="recency",
)

for r in results:
    print(f"[{r.scope}] {r.key}: {r.content[:100]}")

# Forget a stale entry
memory_forget("testing-framework", scope="project")

# Build context block for session injection
block = inject_memory_context("session-abc", "Implement new login flow")
# Returns: <cao-memory>## Context from Fusion Memory\n- [project] ...\n</cao-memory>
```

## Context injection (automatic)

Memory is **automatically injected** as context at the start of each agent
session. The injection:

1. Happens **only once** per session — on the first message after init.
2. Builds a `<cao-memory>` block from relevant memories across
   `session > project > global` scope precedence.
3. Each scope is capped at `MEMORY_MAX_PER_SCOPE` entries and
   `MEMORY_SCOPE_BUDGET_CHARS` characters.
4. The block is prepended to the agent's prompt as system context.

No agent action is required — it's transparent and automatic.

## Best practices

- **Use descriptive keys**: `testing-framework-policy` not `test`.
- **Keep content focused**: one fact per store, not a whole document.
- **Scope correctly**: project conventions go in `project` scope; agent
  preferences go in `agent` scope; cross-project facts go in `global`.
- **Tag liberally**: tags power filtered recall. Use comma-separated tags.
- **Forget stale data**: call `memory_forget` when conventions change.
- **Export before major changes**: `memory export` to back up.
- **Use memory_service directly for bulk operations** rather than individual
  slash commands.

## Searching

Three search modes (resolved automatically):

1. **Metadata** (default, always available) — substring match against
   index entries.
2. **BM25** (optional, requires `rank_bm25` package) — full-text search
   over wiki content with proper term weighting.
3. **Hybrid** — metadata first, BM25 backfill.

Sort modes: `recency` (newest first, default), `score` (BM25 + recency +
usage composite), `usage` (most-accessed).

When no scope is specified, results follow precedence:
`session > project > global`.
