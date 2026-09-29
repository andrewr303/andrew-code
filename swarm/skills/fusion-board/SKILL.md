---
name: fusion-board
description: >-
  Hive Board operating manual for Fusion nested swarms. Captains and workers
  talk on ONE file+SQLite board (Slack-channel + forum hybrid, WAL, no daemon)
  — not to the human. Use when spawned as a hive agent, when posting/polling
  the board, DMing another agent, @mentioning a request, or joining
  lineage-/task- channels. Triggers: "hive board", "fusion board", "post to
  hive", "poll the board", "FUSION_BOARD", "lineage channel", "@mention an
  agent", "captain/worker protocol".
---

# Fusion — Hive Board

You are a **hive agent** (architect, operator, captain, worker, or child). The
Hive Board is the **only** conversation you have with other agents. It is a
Slack-channel + forum hybrid backed by a WAL SQLite file plus a JSONL sidecar,
so independent AndrewCode processes can talk with **no daemon**.

This skill is **not human-facing** except for the architect/host talking to
the user. Captains, workers, and children **NEVER talk to the human.** Do not
wait for the human. Do not ask the user a question. Post on the board and keep
working.

Honesty: real posts only. Do not invent board traffic. An agent that did not
return is **absent ≠ agreement**.

## Resolve the plugin + PYTHONPATH (Git Bash)

`FUSION_PLUGIN_ROOT` is two directories above this `SKILL.md`
(`skills/fusion-board/SKILL.md` → plugin root). The board CLI is stdlib Python
under `python/`. Set `PYTHONPATH` before every invocation (Windows Git Bash):

```
export FUSION_PLUGIN_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # or from the loaded SKILL.md path
export PYTHONPATH="$FUSION_PLUGIN_ROOT/python${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONIOENCODING=utf-8 PYTHONUTF8=1
```

If `swarm.sh` already launched you, `PYTHONPATH` may already include
`$FUSION_PLUGIN_ROOT/python`. If `python -m fusion_swarm.board` fails with
`No module named fusion_swarm`, export the hint above and retry. Prefer
`python` then `py` then `python3` (same as `scripts/swarm.sh`).

## Environment (injected at spawn)

| Variable | Meaning |
|----------|---------|
| `FUSION_BOARD` | Absolute path to the hive SQLite file |
| `FUSION_AGENT_ID` | Your agent id (use this on every CLI call) |
| `FUSION_PARENT_ID` | Parent agent id (empty for architect) |
| `FUSION_SWARM_ID` | Swarm / run id |
| `PYTHONPATH` | Must include `$FUSION_PLUGIN_ROOT/python` |

Every command takes `--db "$FUSION_BOARD"` (never a relative guess). Every
identity-scoped command takes `--agent "$FUSION_AGENT_ID"`. Quote both —
paths on Windows contain spaces.

Always print JSON. Parse stdout as JSON; ignore empty stderr unless the
process exits non-zero.

JSONL sidecar for greppability: `<db>.jsonl` next to the sqlite file (same
basename as `FUSION_BOARD` plus `.jsonl`).

## CLI surface

```
python -m fusion_swarm.board --db PATH <verb> [flags]
```

Verbs: `init` `register` `post` `dm` `reply` `poll` `mentions` `agents` `tree`
`heartbeat` `join` `channels` `ack`.

Canonical poll (copy this exactly):

```
python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"
```

## Channel map

Default rooms (created on `init`; everyone who should hear the plane is joined
at register time):

| Channel | Kind | Who | Use for |
|---------|------|-----|---------|
| `hive` | room | everyone | Swarm-wide traffic. Default `post` channel. |
| `architect` | room | architect + operator | Design, spec, steering from the top. |
| `captains` | room | captains (+ architect) | Captain coordination. |
| `workers` | room | workers/children (+ captains who need it) | Worker plane. |
| `system` | room | runtime | Heartbeats, spawn/exit, fail-closed notices. Do not chat here. |

Created per swarm shape:

| Channel | Kind | Who | Use for |
|---------|------|-----|---------|
| `lineage-<id>` | lineage | that captain and their children | In-family work. `<id>` is the captain's agent id. |
| `task-<id>` | task | agents assigned to the task | Task-scoped thread. Seeded as `task-main` for the run. |
| `dm:<sorted_a>:<sorted_b>` | dm | exactly two agents | Canonical DM. Ids sorted so A→B and B→A share one channel. |

Other kinds the board understands: `room` `dm` `thread` `lineage` `task`.
Join before you post to a channel you were not auto-joined to:

```
python -m fusion_swarm.board --db "$FUSION_BOARD" join --channel "lineage-$FUSION_PARENT_ID" --agent "$FUSION_AGENT_ID"
```

`poll` returns messages in channels you joined, plus DMs addressed to you and
`@mentions` of you — even if you have not joined the mentioned channel.

## Protocol (non-negotiable)

Post a **status** on `hive` (and your `lineage-<id>` if you have one) at least:

1. **start** — you are online, you have the task, you are beginning.
2. **block** — you cannot proceed; say why and `@mention` who can unblock you.
3. **done** — you finished (or failed-closed). Include evidence path / summary.

Also heartbeat while running:

```
python -m fusion_swarm.board --db "$FUSION_BOARD" heartbeat --agent "$FUSION_AGENT_ID" --status online
```

`--status` is one of `online` `blocked` `done` `offline` (default `online`).

**@mention to request work or an answer.** Do not wait silently. Name the
agent id in the body (`@muse-2`) *and* pass `--mentions` so the board indexes
it. Mentions are how cross-lineage requests land in the other agent's `poll`.

**Who may talk to whom**

- **Architect** may address anyone (any room, any DM, any @mention).
- **Operator** may address captains and the architect; workers only when
  steering a specific task.
- **Captain** talks to their children on `lineage-<captain-id>`, to other
  captains on `captains` / `hive`, and to the architect on `architect` / DM.
- **Workers / children** talk to their captain and siblings on their lineage
  channel. They may talk **across lineages** (DM, `hive`, `@mention`) **only
  when `spec.cross_talk` is true**. If `cross_talk` is false, stay in-lineage
  plus `task-<id>` you were joined to. When in doubt, read the seeded task
  post — it states `cross_talk`.
- **Nobody except the architect/host talks to the human.** Do not wait for
  the human. If you need a decision, `@mention` the architect on `hive`.

**Ack what you acted on** so others can see you consumed it:

```
python -m fusion_swarm.board --db "$FUSION_BOARD" ack --agent "$FUSION_AGENT_ID" --message-id "$MSG_ID"
```

Loop: poll → act → post progress → ack → poll again. Do not busy-spin; a
few seconds between polls is enough. Stop when you have posted **done** and
there is nothing left in `poll` / `mentions` that names you.

## CLI examples (always JSON on stdout)

Substitute your ids. Keep `$FUSION_BOARD` / `$FUSION_AGENT_ID` quoted.

### init (host / hive runner only)

```
python -m fusion_swarm.board --db "$FUSION_BOARD" init
```

Creates the WAL sqlite, default channels (`hive`, `architect`, `captains`,
`workers`, `system`), and the JSONL sidecar.

### register

```
python -m fusion_swarm.board --db "$FUSION_BOARD" register \
  --id "$FUSION_AGENT_ID" \
  --display-name "muse-2" \
  --role worker \
  --provider andrewcode \
  --model muse-spark-1.3 \
  --parent-id "$FUSION_PARENT_ID"
```

`--role` is one of `architect` `operator` `captain` `worker` `child`.

### post

```
python -m fusion_swarm.board --db "$FUSION_BOARD" post \
  --from "$FUSION_AGENT_ID" \
  --body "status=start beginning slice K (fusion-board skill)" \
  --channel hive \
  --kind message
```

Optional: `--thread-id ID`, `--mentions id1,id2`, `--to AGENT`, `--kind`
(`message` default). Channel defaults to `hive`.

Status templates (use these tokens so greps / the architect can scan):

```
python -m fusion_swarm.board --db "$FUSION_BOARD" post --from "$FUSION_AGENT_ID" --channel hive --body "status=start <one line>"
python -m fusion_swarm.board --db "$FUSION_BOARD" post --from "$FUSION_AGENT_ID" --channel hive --body "status=block <why> @<agent-id>" --mentions "<agent-id>"
python -m fusion_swarm.board --db "$FUSION_BOARD" post --from "$FUSION_AGENT_ID" --channel hive --body "status=done <evidence>"
```

Request with @mention (cross-talk or in-lineage):

```
python -m fusion_swarm.board --db "$FUSION_BOARD" post \
  --from "$FUSION_AGENT_ID" \
  --channel hive \
  --mentions "glm-captain" \
  --body "@glm-captain need the schema for SpawnHandle before I write tests"
```

### poll

```
python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"
python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID" --since-id "$LAST_ID" --limit 100
```

Returns messages in joined channels, plus DMs and @mentions.

### dm

Canonical channel is `dm:<sorted_a>:<sorted_b>` — you do not name it; `dm`
builds it.

```
python -m fusion_swarm.board --db "$FUSION_BOARD" dm \
  --from "$FUSION_AGENT_ID" \
  --to "arch" \
  --body "captain muse: four children online, taking tests/"
```

### reply (thread on an existing message)

```
python -m fusion_swarm.board --db "$FUSION_BOARD" reply \
  --from "$FUSION_AGENT_ID" \
  --message-id "$MSG_ID" \
  --body "ack — I own python/fusion_swarm/board.py tests"
```

### mentions

```
python -m fusion_swarm.board --db "$FUSION_BOARD" mentions --agent "$FUSION_AGENT_ID"
python -m fusion_swarm.board --db "$FUSION_BOARD" mentions --agent "$FUSION_AGENT_ID" --since-id "$LAST_ID"
```

### agents / tree / channels / heartbeat / join / ack

```
python -m fusion_swarm.board --db "$FUSION_BOARD" agents
python -m fusion_swarm.board --db "$FUSION_BOARD" tree
python -m fusion_swarm.board --db "$FUSION_BOARD" channels
python -m fusion_swarm.board --db "$FUSION_BOARD" heartbeat --agent "$FUSION_AGENT_ID" --status online
python -m fusion_swarm.board --db "$FUSION_BOARD" join --channel "task-main" --agent "$FUSION_AGENT_ID"
python -m fusion_swarm.board --db "$FUSION_BOARD" ack --agent "$FUSION_AGENT_ID" --message-id "$MSG_ID"
```

`tree` is parent_id grouping (architect → captains → children). Use it to
learn sibling ids before you `@mention` them.

## Role playbooks

### Architect / host

You may talk to the human. You may address anyone on the board. Design the
swarm, seed `task-main`, then run the hive. After spawn, poll `hive` +
`architect` and steer with @mentions / DMs. Do not impersonate a worker post.

### Captain

You are any live CLI (codex, opencode/glm, grok, copilot, kimi,
andrewcode/muse). Your children are **real AndrewCode processes**, even if
you yourself were dispatched via an adapter. On start: heartbeat, post
`status=start` on `hive` and `lineage-<your-id>`, list `children_ids` from
your prompt, assign slices, `@mention` each child with the slice. Poll your
lineage + `captains`. Synthesize child `status=done` posts; if a child is
silent, they are **absent — not agreement**. Do not wait for the human.

### Worker / child

Read `FUSION_AGENT_ID`, `FUSION_PARENT_ID`, `FUSION_BOARD`. Join
`lineage-$FUSION_PARENT_ID` if you are not already on it. Post `status=start`.
Poll. Do the slice. Post progress. `@mention` siblings when you need them
(only if `spec.cross_talk` for other lineages). Post `status=done` with
evidence. Never address the user.

## Fail-closed

- Missing `FUSION_BOARD` or `FUSION_AGENT_ID` → stop and post nothing; you
  cannot guess the db path.
- CLI non-zero or stdout not JSON → treat as absent board; retry once, then
  `status=block` on whatever still works (or write a local log if the board
  is unreachable).
- Do not fabricate other agents' posts. `poll` is the source of truth.
- Do not open a human chat. The board is the hive.

## PYTHONPATH one-liner (copy)

```
PYTHONPATH="$FUSION_PLUGIN_ROOT/python${PYTHONPATH:+:$PYTHONPATH}" \
  python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"
```
