---
description: Direct worker steering — attach to a running worker mid-task, interrupt it, send follow-up instructions, or check status. Unlike traditional fire-and-forget sub-agents, you can intervene in real time.
argument-hint: <action> [worker_id] [instruction]
---

Invoke the **fusion-steering** skill with the given action on `$ARGUMENTS`.

Supported actions:
- `attach <worker_id>` — attach to a running worker, view its current task and status
- `interrupt <worker_id>` — cancel a running worker process
- `steer <worker_id> <instruction>` — send a mid-task instruction to a running worker
- `status [worker_id]` — show status of one or all workers
- `inbox <worker_id>` — check pending messages in a worker's inbox

Unlike traditional "sub-agent" features where the parent fires and forgets,
Fusion Steering lets the supervisor attach to in-flight workers, send
mid-stream corrections, or cancel and restart with different parameters.
All steering actions return structured `SteeringResult` contracts.
