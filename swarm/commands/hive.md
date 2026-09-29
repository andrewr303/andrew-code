---
description: Nested Hive — architect (Fable 5.1 / Astra) plus live-CLI captains, each spawning real AndrewCode worker processes that talk on one Hive Board (Slack-channel + forum hybrid, file+SQLite). Nested swarm with cross-talk; the human talks only to the architect/host.
argument-hint: <coding task> [--dry-run] [--architect fable|astra] [--children-per-captain N] [--spec-file path.json] [--captains csv]
---

CRITICAL — DIRECT EXECUTION: Resolve `FUSION_PLUGIN_ROOT` from the loaded skill path and immediately run the hive engine with a *relative* path. NEVER begin with location searches (`find ~`, `find ~/.codex`, `find ~/.claude`, broad `ls`/`grep` of home) — they hang on Windows/OneDrive and are not needed. First command (dry-run builds the tree + board without subprocesses; drop `--dry-run` only after the user confirms a live fan-out):

```
bash scripts/swarm.sh hive "<one-line goal>" --dry-run --json
```

Honor `$ARGUMENTS`. Useful flags (forwarded through `swarm.sh` → `python -m fusion_swarm hive`):

```
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh hive "$ARGUMENTS" --dry-run --json
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh hive "<task>" --architect fable --children-per-captain 4 --json
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh hive "<task>" --spec-file spec.json --json
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh hive "<task>" --captains "codex,opencode,grok,andrewcode" --json
```

A live roster first (inventory, not a hive run): `bash $FUSION_PLUGIN_ROOT/scripts/fusion.sh detect --json` and `bash $FUSION_PLUGIN_ROOT/scripts/fusion.sh providers`. Captains that are not nested AndrewCode processes still go through the verified adapters (`fusion.sh dispatch <prov> …`); nested workers are always real `andrewcode` processes (`andrewcode -p … -m <model> --auto --yolo --output-format text`).

Invoke the **fusion-hive** skill.

The skill will:
- Create one Hive Board (WAL SQLite + JSONL sidecar) and register the architect, operator, captains, and workers.
- Ensure default rooms (`hive`, `architect`, `captains`, `workers`, `system`) plus per-captain `lineage-<captain>` channels and `task-main`.
- Spawn nested children as AndrewCode identities even when the captain is opencode/glm/grok/copilot/kimi — the captain talks to its children over the board; children of different captains can talk when `cross_talk` is on; the architect can talk to everyone.
- Post the task to the board. Workers post progress, `@mention` agents they need, and NEVER talk to the human. You (the host/architect) are the only human-facing surface.
- If `--dry-run`: do **not** subprocess; still build the tree + board and return the seeded posts. Live dispatch is real or absent — never simulated.
- Return a result dict: `pattern=hive`, `run_id`, `board_path`, `spec`, `agents`, `tree`, `posts_seeded`, `dry_run`.

Default shape (overridable by a designer `SwarmSpec`): 4 captains × 4 children, `SpawnLimits(max_depth=2, max_children_per_agent=4, max_agents=24)`. Depth/budget is enforced **before** spawn. Example: muse-spark-1.3 and glm-5.3 each spawn 4 children; captains talk to their children; children can cross-talk; the architect talks to everyone — all on **one** Hive Board, not a human Slack.

Inspect the board without another hive run via `/fusion:board`. Design a custom topology first via `/fusion:designer`.

Hard rules (same as the rest of Fusion): real dispatch only; absent ≠ agreement; stdlib-only Python; Windows+Git Bash; no live paid CLI calls from tests (`--dry-run` is the offline path). Ask before anything destructive, production, or paid-large. A missing captain is **absent**, not a vote.
