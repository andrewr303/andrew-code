# Fusion MetaLoop

**MetaLoop — Fable 5 as CEO + Chief Operator + tiered swarm.** An explicit
Fusion mode (`fusion:metaloop`) that behaves like a well-run engineering org
rather than "five agents in a room": a CEO who frames every run, one accountable
operator who executes under that frame, senior specialists, a fast execution
bench, and deterministic checks that decide what can be decided mechanically.

This is **Phase 1** (real-repo proposal mode, explicit opt-in). Worktree
isolation and telemetry-informed auto-routing are deferred to later phases.

## Roles

| Plane | Role | Provider / harness | Responsibility |
|---|---|---|---|
| **CEO** | **Board Advisor (CEO)** | Fable 5 via `scripts/providers/fable.sh` (Claude Code print mode) | **Frames EVERY run first** — outcome, decomposition strategy, risk priorities, taste bar. Sets direction; **not a worker, not a vote** |
| Host | Chief Operator | GPT via Codex host (in-context) | Plan under the CEO frame, decompose, keep critical work, route, integrate, verify, own the outcome |
| Expert | Expert A | Grok 4.5 via `grok.sh` | Novel diagnosis, adversarial edge cases, alternative architecture, current context |
| Expert | Expert B | GLM 5.2 via `opencode.sh` | Repo-scale reading, complex/multi-file implementation, broad refactors |
| Fast | Fast A + B | **Two Antigravity sessions** (`agy.sh`, Gemini 3.5 Flash High) | Inventory, scaffolding, mechanical edits, focused edits, tests, docs |
| Control | Deterministic runtime | `python/fusion_swarm/*` + adapters | Contracts, routing, waves, budgets, gates, escalation, ledger |

**Asymmetry is the point.** Fable is the CEO — it frames every run before any
work begins — but it never implements, dispatches, or votes. GPT stays
accountable, executes under the frame, and records whether it adopted or
overrode each CEO directive. **A failing deterministic gate outranks every model
opinion, including the CEO's.** Copilot is **not** a MetaLoop worker.

## Modules

| File | Purpose |
|---|---|
| `python/fusion_swarm/contracts.py` | `TaskSpec`, `WorkerResult`, `AdvisorMemo`, `GateResult` dataclasses with fail-closed validation (stdlib only). Mirrors `docs/metaloop.schema.json`. |
| `python/fusion_swarm/policy.py` | Hard overrides (host-owned work) first, then the transparent `expert_pressure` score. |
| `python/fusion_swarm/workspaces.py` | Proposal strategy + scope gate (changed paths vs allow/forbid). Worktree is a Phase-2 placeholder that refuses to run. |
| `scripts/providers/_common.sh` | `fusion_snapshot_repo` (populated per-worker repo snapshot for READ) + `fusion_prompt_text` (E2BIG-safe prompt transport). |
| `python/fusion_swarm/metaloop.py` | Run-state machine, dependency waves, correlation-aware family counting, advisor triggers, bounded escalation ladder, run record. |
| `scripts/providers/fable.sh` | Read-only structured Fable advisor (stdin-fed, no side-effect tools, empty scratch cwd). |
| `scripts/providers/agy.sh` | Antigravity fast-worker adapter with capability detection (does not assume Gemini/Copilot flags). |

## Routing

Hard overrides win first: auth, secrets, DB migrations, money/legal, public
API/data contracts, cross-cutting architecture, production config, merge
conflicts, and final integration are kept by the Chief Operator. Destructive /
production / paid-large work additionally raises a human-approval flag.

Otherwise a single explainable score decides:

```
expert_pressure = 2*risk + 2*complexity + context_size + novelty + ambiguity
                  + blast_radius - latency_priority - verification_strength
```

- `expert_pressure >= 8` → expert lane
- `expert_pressure <= 3` and `risk <= 1` → fast lane
- otherwise → host chooses using strengths, availability, and ledger evidence

## Correlation rule

The fast tier is **two `agy` sessions on the same Gemini 3.5 Flash model** — the
same provider and model, so they are inherently **one Gemini family** (throughput
and execution diversity, never two independent votes). `count_model_families`
collapses them to one and `is_fake_consensus(["agy","agy"])` is `True`. Copilot
(also Gemini) is not a MetaLoop worker but stays in the correlation map so any
mixed base-panel run is counted correctly. Never present two Gemini outputs as
two-model consensus.

## Workspace (real-repo proposal mode)

MetaLoop workers must **read the real codebase**, so each worker is given a
disposable per-worker **snapshot** of the repo (`fusion_snapshot_repo`) inside
its scratch dir. It reads (and may edit) only that copy — the user's checkout is
never touched — and returns a patch/artifact the host reconciles. This fixes the
old "empty sandbox can't see the repo" failure while preserving the no-user-tree-
write invariant and staying safe under concurrency (each worker its own copy).
Pass the repo as the 6th arg to `fusion.sh dispatch` (or set `FUSION_WORKER_REPO`).
Prompts are E2BIG-safe: large capsules become `work/.fusion-task.md` the worker
reads from its own cwd instead of overflowing argv.

## Budgets (defaults)

```
advisor_policy            always      max_repair_rounds        2   (Fable is the CEO)
max_advisor_calls         2           max_attempts_per_task    3
expert_concurrency        2           max_total_external_calls 12
fast_concurrency          2 (2x agy)  max_wall_seconds         1800
workspace_mode            proposal    risk_threshold           2
```

Override via env (`FUSION_META_*`, see `config/defaults.env`) or CLI flags.

## CLI

```
# scaffold: config + live roster (tiers) + correlation groups
bash scripts/swarm.sh metaloop "Refactor billing and add tests"

# with a task DAG: routing decisions + dependency waves + advisor preflight
bash scripts/swarm.sh metaloop "..." --plan-file plan.json --json \
  --advisor auto --advisor-max 2 --max-repair-rounds 2 \
  --expert-concurrency 2 --fast-concurrency 2 --workspace-mode proposal
```

`plan.json` is a JSON array of TaskSpec objects (see `docs/metaloop.schema.json`).

The host-native control protocol (how GPT actually drives a run) lives in
`skills/fusion-metaloop/SKILL.md`. The Python module is the deterministic state +
dispatch engine; it does not pretend to call the running host as a subprocess.

## Escalation ladder (bounded)

```
malformed_output   -> one schema-repair retry, then escalate
timeout/error/absent -> alternate worker, same tier
verification/low-confidence -> fast: promote to expert; expert: host takeover
scope_violation    -> host review (reject + replan)
expert_conflict    -> host adjudicates
plan_failure       -> Fable systemic consult (within advisor budget) else stop
budget/attempt caps -> stop and synthesize partial state honestly
approval_required  -> pause for a human
```

## What Phase 1 deliberately does NOT do

- No git-worktree parallel writes (Phase 2).
- No automatic selection of MetaLoop by `scripts/route.sh` (Phase 3 — after
  verified telemetry).
- No treating Fable's safeguard fallback as premium advice — it is recorded as
  `fallback`.
