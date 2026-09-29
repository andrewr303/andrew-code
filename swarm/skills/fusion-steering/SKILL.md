---
name: fusion-steering
description: >-
  Direct worker steering — attach to running workers mid-task, interrupt,
  redirect, or check status. Unlike traditional fire-and-forget sub-agents,
  you can intervene in real time with a running worker. All steering actions
  return typed SteeringResult contracts. Use for: correcting a worker
  mid-flight, cancelling a stuck worker, sending follow-up instructions,
  checking worker status during a long-running swarm. Triggers: "steer worker",
  "attach to worker", "interrupt worker", "cancel worker", "worker status",
  "/fusion:steer", "what are my workers doing".
---

# Fusion Worker Steering

You provide **direct worker steering** — the ability to attach to, interrupt,
or redirect running workers mid-task. This is in contrast to traditional
"sub-agent" patterns where the parent fires and forgets.

## The steering registry

Every worker launched by the Hierarchical Supervisor or MetaLoop is
registered in the `WorkerRegistry` (process-global, thread-safe).
Each worker has:

- `session_id` — unique identifier (`worker-{uuid}`)
- `worker_profile` — provider name (codex, copilot, opencode, grok, agy)
- `status` — idle | running | blocked | completed
- `task` — current task description
- `supervisor_id` — parent session that created it
- `pid` — OS process ID (if known)

## Steering actions

| Action | What it does | Use when |
|--------|-------------|----------|
| `attach` | View worker status and task | Inspect what a worker is doing |
| `interrupt` | Kill worker process (SIGTERM / Ctrl-Break) | Worker is stuck or going off track |
| `steer` | Send eager inbox message mid-task | You want to redirect without restarting |
| `status` | List all active workers | Dashboard overview of a running swarm |

## Slash commands

- `/fusion:steer attach <worker_id>` — view worker status and current task
- `/fusion:steer interrupt <worker_id>` — cancel a running worker
- `/fusion:steer steer <worker_id> <instruction>` — send mid-task instruction
- `/fusion:steer status [worker_id]` — status of one or all workers
- `/fusion:steer inbox <worker_id>` — check pending messages

## Python API

```python
from fusion_swarm.steering import (
    attach, interrupt, steer, status,
    register_worker, WorkerRegistry,
)

# Register a worker (normally done automatically by Supervisor)
ws = register_worker("worker-abc", "codex", supervisor_id="supervisor-1",
                      task="Migrate logger calls in handlers/")

# Attach — check what it's doing
result = attach("worker-abc")
print(result)
# {"action": "attach", "worker_id": "worker-abc", "success": true,
#  "message": "Attached to worker 'codex' (status: running, task: Migrate...)"}

# Steer — send a mid-task correction
result = steer("worker-abc", "Also update the test files alongside the handlers.")
print(result)
# {"action": "steer", "worker_id": "worker-abc", "success": true, ...}

# Interrupt — cancel the worker
result = interrupt("worker-abc", timeout=5)
print(result)
# {"action": "interrupt", "worker_id": "worker-abc", "success": true,
#  "message": "Worker 'codex' interrupted."}

# List all workers
workers = status()
for w in workers:
    print(f"{w['session_id']}: {w['status']} — {w['task'][:60]}")
```

## Inbox delivery

Messages sent via `steer()` arrive in the worker's **inbox**. The worker
processes them:

- **Immediately** (eager delivery) for `steer` messages — the instruction
  is delivered as additional context on the next response cycle.
- **When idle** (queued delivery) for `send_message` communications between
  workers.

The supervisor can drain its own inbox to collect worker callbacks::

```python
msgs = WorkerRegistry.drain_inbox("supervisor-1")
for m in msgs:
    print(f"From {m.sender_id}: {m.content}")
```

## Integration with Hierarchical Supervisor

The improved `Supervisor` class (in `hierarchical.py`) automatically:

1. **Registers** every worker in the WorkerRegistry at dispatch time.
2. **Exposes** `steer_worker(worker_id, instruction)` and
   `interrupt_worker(worker_id)` as first-class methods.
3. **Updates** worker status when tasks complete.
4. **Collects** worker callbacks from the inbox.

```python
from fusion_swarm.hierarchical import Supervisor

sv = Supervisor(director="codex", session_id="build-1")

# Start a swarm (runs in background thread)
import threading
t = threading.Thread(target=sv.decompose_and_dispatch, args=("Migrate logging",))
t.start()

# While running, check workers
for w in sv.worker_statuses():
    print(f"{w['session_id']}: {w['status']}")

# Steer a specific worker
sv.steer_worker("build-1-w0", "Also check for log.Fatal usage.")

# Interrupt if needed
# sv.interrupt_worker("build-1-w1")
```

## Isolation guarantees

- Workers run in **separate CLI processes** (not simulated sub-agents).
- Workers do **not** see the supervisor's full conversation history.
- Workers see only their task + injected memory context.
- The supervisor's reasoning, tool calls, and private state are **never**
  exposed to workers.
- Steer messages are the only way the supervisor communicates mid-task.
