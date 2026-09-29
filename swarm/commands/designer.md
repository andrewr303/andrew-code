---
description: Swarm designer — Fable 5.1 and/or Astra (Codex `gpt-6-astra`) emits a fail-closed SwarmSpec JSON for a nested hive (or any catalog form). User-specified models/providers are hard constraints; everything else is the architect's call, including a custom topology when the catalog does not fit.
argument-hint: <task> [--architect fable|astra] [--packet] [--constraints "..."] [--out spec.json]
---

CRITICAL — DIRECT EXECUTION: Resolve `FUSION_PLUGIN_ROOT` from the loaded skill path and immediately build the design packet with a *relative* path. NEVER begin with location searches (`find ~`, `find ~/.codex`, `find ~/.claude`, broad `ls`/`grep` of home). First command (packet-only — prompt + live roster, **no** paid CLI call):

```
bash scripts/swarm.sh designer "<one-line goal>" --packet --json
```

Honor `$ARGUMENTS`. Then, only after the user confirms a live architect call:

```
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh designer "$ARGUMENTS" --json
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh designer "<task>" --architect fable --json
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh designer "<task>" --architect astra --json
```

Live Fable/Astra dispatch uses the verified adapter, not a simulated memo:

```
bash $FUSION_PLUGIN_ROOT/scripts/fusion.sh detect --json
bash $FUSION_PLUGIN_ROOT/scripts/fusion.sh dispatch fable <packet.txt> <spec.json> "$FUSION_FABLE_MODEL"
bash $FUSION_PLUGIN_ROOT/scripts/fusion.sh dispatch codex <packet.txt> <spec.json> gpt-6-astra
```

Invoke the **fusion-designer** skill.

The skill will:
- Load the topology catalog (at least): solo, panel, council, debate, vote, swarm, hierarchy, metaloop, moa, heavy, discuss, graph, ladder, speclock, breaker, ballot, factory, diamond, nested-hive, ultraswarm, ureview, custom. Each form has `name`, `when`, `mechanic`, `communication` (blind|board|lineage|open), `nesting`, `default_captains`, `default_children`, `cost_shape`.
- Build `design_prompt(task, live_roster, constraints)` for Fable/Astra. The architect must emit **ONLY** SwarmSpec JSON (tolerate markdown fences). It has latitude to invent a custom topology when catalog forms do not fit.
- Parse with `parse_swarm_spec` and fail-closed `validate_spec(spec, live_roster)`. User-specified models/providers are **hard constraints**; absent providers stay absent — never silently substituted, never treated as agreement.
- SwarmSpec fields: `name`, `architect` (provider+model), `operator`, `captains` (list of `{id,provider,model,spawn,spawn_via}`), `cross_talk`, `board`, `max_depth`, `max_children_per_agent`, `max_agents`, `budget`, `communication` (open|lineage|need-to-know), `task`, `notes`.
- `--packet` returns the design packet (prompt + roster) and **must not** call live models — this is the offline/test path. A live run writes the spec (optionally `--out spec.json`) for `/fusion:hive --spec-file spec.json`.

Hard rules: real dispatch only; absent ≠ agreement; stdlib-only Python; Windows+Git Bash; tests stay offline (`--packet`, never a paid CLI). Do not invent a spec in-context and present it as Fable's — if the architect is absent, say so and stop.
