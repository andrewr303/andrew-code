# Fusion Codex Plugin

This is the Codex conversion of Fusion. It keeps the full backend from the
source bundle:

- `skills/` Codex skill entrypoints
- `scripts/` bash provider adapters, routing, ledger, UltraCode bridge
- `python/fusion_swarm/` stdlib swarm engine
- `config/`, `memory/`, `tests/`, `mcps/`, `commands/`, and bundled `ultracode/`

## Install

The plugin is registered in the personal Codex marketplace at:

```text
C:\Users\Andrew\.agents\plugins\marketplace.json
```

Install or refresh it with:

```bash
codex plugin add fusion@personal
```

Start a new Codex thread after installing so the new skills are loaded.

## Runtime Model

Codex is the conductor, judge, and synthesizer. External panelists are invoked
through local CLIs when available:

- `copilot`
- `opencode`
- `grok`
- optional `codex` CLI when `FUSION_HOST=none`

By default `FUSION_HOST=codex`, so the plugin does not recursively invoke the
Codex CLI as a panelist. To intentionally run an external Codex subprocess:

```bash
FUSION_HOST=none bash "$FUSION_PLUGIN_ROOT/scripts/fusion.sh" panel ...
```

## MetaLoop runtime contract (`fusion:metaloop`)

Fable 5 is the **CEO / Board Advisor**: it frames EVERY run first (outcome,
decomposition, risk, taste) — it sets direction but is never a worker or a vote.
Codex is the **Chief Operator**: it plans under that frame, keeps critical/cross-
cutting work, routes bounded tasks to tiered workers, and integrates. Grok and
OpenCode/GLM are expert workers; the fast tier is **two Antigravity (`agy`)
sessions on Gemini 3.5 Flash** (one correlated family). Copilot is not a MetaLoop
worker.

- Contracts are enforced in `python/fusion_swarm/contracts.py` (`TaskSpec`,
  `WorkerResult`, `AdvisorMemo`, `GateResult`); routing in `policy.py`; run state /
  waves / escalation in `metaloop.py`; workspace safety in `workspaces.py`.
- Advisor + fast-worker adapters: `scripts/providers/fable.sh` (read-only
  `claude -p`) and `scripts/providers/agy.sh` (capability-detecting Antigravity).
- The engine scaffold (config + live roster with tiers + correlation groups, and,
  with `--plan-file`, routing + dependency waves + advisor preflight):

  ```bash
  bash "$FUSION_PLUGIN_ROOT/scripts/swarm.sh" metaloop "<goal>" [--plan-file plan.json] [--json]
  ```

- Invariants: real dispatch only; absent ≠ agreement; the two `agy` fast sessions
  are ONE Gemini family (not two votes); deterministic gates outrank model opinion
  (even the CEO's); real-repo proposal mode lets workers read a disposable repo
  snapshot but keeps them out of the user checkout; budgets are hard;
  destructive/production/paid-large actions pause for a human. Full spec:
  `docs/METALOOP.md`.

## Using In Codex

Use natural-language triggers, for example:

```text
fusion setup
use Fusion on this architecture decision
use Fusion gate with npm test
run a Fusion council for this migration plan
```

The copied `commands/` directory is retained as reference material from the
Claude plugin. Codex does not load those files as slash commands.

## Verify

Offline checks:

```bash
bash tests/validate.sh
python -m py_compile python/fusion_swarm/*.py
```

Live smoke checks cost CLI calls:

```bash
bash tests/smoke-providers.sh
```

