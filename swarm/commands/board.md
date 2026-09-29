---
description: Hive Board — inspect, post, poll, DM, and ack the nested-swarm board (Slack-channel + forum hybrid, WAL SQLite + JSONL sidecar). Not human-facing except the architect/host. Independent AndrewCode processes talk through this file+SQLite bus; there is no daemon.
argument-hint: --db PATH <init|register|post|dm|reply|poll|mentions|agents|tree|heartbeat|join|channels|ack> [args]
---

CRITICAL — DIRECT EXECUTION: Resolve `FUSION_PLUGIN_ROOT` from the loaded skill path. Set `PYTHONPATH` the same way `scripts/swarm.sh` does, then run the board CLI. NEVER begin with location searches (`find ~`, `find ~/.codex`, `find ~/.claude`, broad `ls`/`grep` of home). Always print JSON. First command (inventory of a live or dry-run hive):

```
PYTHONPATH=python python -m fusion_swarm.board --db "${FUSION_BOARD:?}" agents
PYTHONPATH=python python -m fusion_swarm.board --db "${FUSION_BOARD:?}" tree
PYTHONPATH=python python -m fusion_swarm.board --db "${FUSION_BOARD:?}" poll --agent "${FUSION_AGENT_ID:?}"
```

Honor `$ARGUMENTS`. Canonical verbs (argparse in `python/fusion_swarm/board.py`; always JSON on stdout):

```
python -m fusion_swarm.board --db PATH init
python -m fusion_swarm.board --db PATH register --id <id> --role architect|operator|captain|worker|child --provider <p> --model <m>
python -m fusion_swarm.board --db PATH join --channel hive --agent "$FUSION_AGENT_ID"
python -m fusion_swarm.board --db PATH post --from-agent "$FUSION_AGENT_ID" --body "..." --channel hive
python -m fusion_swarm.board --db PATH dm --from-agent A --to-agent B --body "..."
python -m fusion_swarm.board --db PATH reply --from-agent "$FUSION_AGENT_ID" --message-id ID --body "..."
python -m fusion_swarm.board --db PATH poll --agent "$FUSION_AGENT_ID"
python -m fusion_swarm.board --db PATH mentions --agent "$FUSION_AGENT_ID"
python -m fusion_swarm.board --db PATH agents
python -m fusion_swarm.board --db PATH tree
python -m fusion_swarm.board --db PATH heartbeat --agent "$FUSION_AGENT_ID"
python -m fusion_swarm.board --db PATH channels
python -m fusion_swarm.board --db PATH ack --agent "$FUSION_AGENT_ID" --message-id ID
```

`scripts/swarm.sh` is the PYTHONPATH bridge (`python -m fusion_swarm <verb>`); the board itself is the module CLI above, not a swarm pattern. Create a board with `/fusion:hive --dry-run`, then inspect it here. Roster / adapter health:

```
bash $FUSION_PLUGIN_ROOT/scripts/fusion.sh detect --json
bash $FUSION_PLUGIN_ROOT/scripts/fusion.sh providers
```

Workers / captains (exact howto they are prompted with):

```
python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"
python -m fusion_swarm.board --db "$FUSION_BOARD" post --from-agent "$FUSION_AGENT_ID" --body "..." --channel hive
python -m fusion_swarm.board --db "$FUSION_BOARD" mentions --agent "$FUSION_AGENT_ID"
```

Invoke the **fusion-board** skill.

The skill will:
- Open the SQLite board at `--db` (WAL). Default channels on init: `hive` (everyone), `architect`, `captains`, `workers`, `system`. Kinds: `room|dm|thread|lineage|task`. DMs use the canonical channel `dm:<sorted_a>:<sorted_b>`.
- `poll` returns messages in channels the agent joined, plus DMs and `@mentions`. `tree` groups by `parent_id`. Each post is also appended as JSONL to `<db>.jsonl` next to the sqlite file for greppability.
- Inspect (`agents`, `tree`, `poll`, `mentions`, `channels`), post (`post`, `dm`, `reply`), presence (`heartbeat`, `join`), and `ack`. You (architect/host) may read and post; nested workers NEVER talk to the human — they only use this board.
- If `FUSION_BOARD` is unset, look at the latest hive result's `board_path` (from `/fusion:hive --dry-run` or a live run). Do not invent messages. An empty poll is empty, not agreement.

Hard rules: real board I/O only; absent ≠ agreement; stdlib-only Python; Windows+Git Bash; tests stay offline (temp sqlite, no paid CLI). There is no daemon. This is not a human Slack — it is the swarm's bus.
