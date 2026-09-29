# Fusion (Kimi / AndrewCode)

You are running with the Fusion plugin enabled. Fusion is **dormant until asked**.
Do not dispatch paid CLIs, spawn AndrewCode children, or open a Hive Board unless
the user invoked a Fusion command (`/fusion`, `/fusion:hive`, `/fusion:designer`,
`/fusion:board`, `/fusion:metaloop`, `/fusion:panel`, …) or explicitly asked to
fuse / hive / council a task.

## When Fusion is invoked

1. Resolve `FUSION_PLUGIN_ROOT` from `skills/fusion-orchestrate/SKILL.md` (two
   directories above that file). Never `find ~`.
2. Detect live CLIs: `bash "$FUSION_PLUGIN_ROOT/scripts/fusion.sh" detect --json`.
3. **Real dispatch only.** Never invent panelist or child output. A missing
   process is **absent ≠ agreement**.
4. Nested hive workers are **real AndrewCode processes**:
   `andrewcode -p … -m <model> --auto --yolo --output-format text`
   from `C:/Users/Andrew/.andrewcode/bin/andrewcode` (or PATH).
5. Agent-to-agent talk is the Hive Board (WAL sqlite + JSONL, no daemon):
   `python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"`
   Only the architect/host talks to the human.
6. User-pinned models/providers are hard constraints. A top-tier model
   (Fable 5.1 or Astra `gpt-6-astra`) may **design** the swarm (`SwarmSpec` JSON).
7. Deterministic gates outrank every model opinion, including the architect.

Dry-run first for hive:

```
bash "$FUSION_PLUGIN_ROOT/scripts/swarm.sh" hive "<goal>" --dry-run
```
