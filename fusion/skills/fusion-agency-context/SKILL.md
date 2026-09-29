---
name: fusion-agency-context
description: >-
  Manage the shared agency context — a centralized data store accessible by all
  tools and agents within a Fusion session. Store data with one tool and retrieve
  it with another, eliminating explicit parameter passing and saving tokens.
  Use for multi-step workflows, complex data sharing, and session state management.
  Triggers: "agency context", "context.set", "context.get", "master context",
  "share state", "/fusion:context", "store in context", "get from context".
---

# Fusion Agency Context

You manage the **agency context** — a centralized dictionary store that every
tool and agent in a Fusion session can read from and write to. It eliminates the
need for explicit parameter passing between tools: Tool A stores data with
`.set()`, and Tool B retrieves it with `.get()`.

## The Python API

All context operations go through the `fusion_swarm.agency_context` module::

```python
from fusion_swarm.agency_context import session_context, AgencyContext, MasterContext

# Get or create a context for this session (process-global, survives tool calls)
ctx = session_context("my-session-id")

# Write
ctx.set("customer_data", {"id": "CUST123", "name": "Alice", "status": "active"})
ctx.set("workflow_status", "data_collected")
ctx.set("last_query", "SELECT * FROM orders WHERE ...")

# Read — always use defaults
data = ctx.get("customer_data", {})
status = ctx.get("workflow_status", "unknown")

# One-shot (pop once, use, discard)
intermediate = ctx.pop("temp_result", None)

# Bulk
ctx.merge({"phase": 2, "priority": "high"})
snap = ctx.snapshot()   # shallow copy for audit trails
```

## Context manager pattern (scoped blocks)

```python
with AgencyContext({"session_id": "abc"}) as ctx:
    ctx.set("phase", "collect")
    do_work(ctx)
    # ctx still alive — all sets persist
# after the block: context cleared
```

By default, nested ``AgencyContext`` blocks inherit the parent context
(so a supervisor's context is visible to workers). Pass ``inherit=False``
for full isolation.

## Slash commands

- `/fusion:context get <key>` — read a value from the shared agency context
- `/fusion:context set <key> <value>` — store a value
- `/fusion:context list` — show all keys currently in the context
- `/fusion:context clear` — drop the entire context
- `/fusion:context snapshot` — export the full context as JSON

When a user invokes `/fusion:context`, you:

1. **Read** the requested action.
2. **Call** the corresponding Python function via the plugin's Python engine
   (or access the session context directly if running in-process).
3. **Return** the result — a single value for `get`, a list of keys for
   `list`, an acknowledgment for `set`/`clear`/`snapshot`.

## Best practices

- **Use descriptive keys** to avoid conflicts: `user_portfolio_analysis_2024`,
  not `data`.
- **Always provide defaults** on reads: `ctx.get("key", {})`, not bare
  `ctx.get("key")`.
- **Clean up temporary data** for long-running sessions — ``ctx.pop("temp")``
  or periodic `ctx.clear()`.
- **Never pass secrets** through the context — it persists in memory for the
  session lifetime. Use scoped variables instead.
- **Check for missing data** before acting: ``if ctx.get("phase") != "ready"``.

## Complex data structures

The context can store any Python object — dictionaries, lists, dataclass
instances, even file handles (though the latter is discouraged). This makes
it suitable for complex workflows::

```python
market_analysis = {
    "timestamp": datetime.now().isoformat(),
    "symbols": {"AAPL": {"price": 150.0, "trend": "bullish"}},
    "summary": "Positive outlook across tech sector",
}
ctx.set("market_analysis", market_analysis)
```

## Workflow coordination

Use agency context to coordinate multi-step workflows. Each step stores its
output and checks that the previous step completed::

```python
# Step 1: collect
result = collect_data()
ctx.set("workflow_step_1", result)
ctx.set("workflow_status", "step_1_complete")

# Step 2: process (in a different tool call, same session)
if ctx.get("workflow_status") != "step_1_complete":
    return "Error: Step 1 must be completed first"
data = ctx.get("workflow_step_1")
result = process_data(data)
ctx.set("workflow_step_2", result)
ctx.set("workflow_status", "step_2_complete")
```

## Migrating from BaseTool to function_tool pattern

If you're porting tools from Agency Swarm's BaseTool pattern:

```python
# Old BaseTool pattern
class MyTool(BaseTool):
    async def run(self):
        assert self.context is not None
        self.context.set("key", "value")
        data = self.context.get("key", "default")
        return "Done"

# New Fusion pattern
from fusion_swarm.agency_context import session_context

def my_tool(session_id="default"):
    ctx = session_context(session_id)
    ctx.set("key", "value")
    data = ctx.get("key", "default")
    return "Done"
```

The `session_context()` function replaces `self.context` — it provides the
same `.get()`/`.set()` API without requiring the OpenAI Agents SDK.

## Integration with hierarchical workers

When using the improved Hierarchical Supervisor pattern (see `fusion-steering`
skill), each worker automatically gets a scoped agency context. The supervisor
can read what workers stored, and workers can read shared state::

```python
from fusion_swarm.hierarchical import Supervisor

sv = Supervisor(director="codex", session_id="build-1")
result = sv.decompose_and_dispatch("Migrate logger calls")

# After dispatch, shared context contains worker results
for key in sv.context.keys():
    if key.startswith("callback_"):
        print(f"{key}: {sv.context.get(key)}")
```
