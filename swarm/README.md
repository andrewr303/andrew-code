# Fusion
> **AndrewAgent** lives in `andrewagent/`, launch with `avr`. See `andrewagent/docs/REBRAND.md`.


> Codex conversion note: this installed copy is a Codex plugin. Read
> [`CODEX.md`](CODEX.md) for the active Codex install and runtime contract.
> The rest of this README is retained from the original Claude-oriented source
> documentation for background.

**Put a panel of frontier models on the work that matters — or nest a whole swarm of real AndrewCode processes under captains that talk on one Hive Board.**

Fusion is a Claude Code / Codex plugin that orchestrates several top-tier coding CLIs —
**codex (gpt-5.5 / Astra `gpt-6-astra`)**, **copilot (gemini-3.5-flash)**, **opencode (glm-5.2 / glm-5.3)**, **grok**, **kimi**, and **andrewcode (muse)** —
under one conductor (Claude Opus, Fable 5.1, or Astra). It doesn't follow a rigid pipeline. It reads the task,
**chooses how the panel should collaborate** (or lets the architect **design a custom nested hive**), dispatches the live CLIs in parallel, judges
and synthesizes one calibrated answer, and **records every run so it gets better over time.**

The bet is empirical. On OpenRouter's deep-research benchmark, *fusing* multiple models beat
every individual model — a diverse panel synthesized by Opus reached **beyond-frontier**
scores, and the synthesis step alone added ~6.7 points even when fusing one model with
itself. Fusion brings that result to your terminal, using CLIs you already have.

> One model can be confidently wrong. Four different model families, each doing its own
> tool-using research, rarely share the same blind spot — and a real synthesis step turns
> their disagreement into a better answer than any of them gave alone.

---

## Collaboration modes

Fusion is **dynamic**: Claude picks the mode per task (you can also force one).

| Mode | When it's chosen | What happens |
|------|------------------|--------------|
| **solo** | trivial / already certain | answer directly (1× cost, labeled honestly) |
| **panel** | research, "compare", clear-deliverable code | blind parallel fan-out → 5-section judge synthesis |
| **council** | high-stakes open decision | blind → anonymized cross-exam (anti-conformity) → verdict + minority report |
| **debate** | a contested either/or | two models argue opposing sides, Claude adjudicates the cruxes |
| **vote** | a checkable answer (math, a fact) | model-free majority, no judge call — the cheapest fusion |
| **swarm** | large/parallelizable build | decompose → route subtasks to the best CLI → assemble & verify |
| **hive** | nested coding swarm, "design a swarm", repo-scale parallel build | architect designs a `SwarmSpec` → captains (any live CLI) → nested **AndrewCode** children on one Hive Board |
| **designer** | architect latitude / custom topology | Fable/Astra emits fail-closed `SwarmSpec` JSON from the catalog (or invents `custom`) |
| **board** | process-shared talk | WAL SQLite Hive Board + JSONL sidecar; DMs, rooms, lineage, `@mentions` — no daemon |

Modes nest: a swarm subtask can be a panel; a council can open with a vote; a hive child can be a breaker.

## Hive — nested AndrewCode swarm on one board

Hive is Fusion's nested multi-agent coding swarm. The architect talks to the human
and may **DESIGN** the swarm; captains are any live CLI; nested workers are **real
AndrewCode processes**; communication is **one Hive Board** (Slack-channel + forum
hybrid, file + WAL SQLite, no daemon). Full contract: [`docs/HIVE.md`](docs/HIVE.md).

```
architect  (Fable 5.1  and/or  Astra via Codex gpt-6-astra)
│
├── captain muse-spark-1.3     ── 4 nested AndrewCode children
├── captain glm-5.3            ── 4 nested AndrewCode children
├── captain grok
└── captain copilot
```

That **4-captain / 8-child** shape is the running example: muse-spark-1.3 and
glm-5.3 each spawn four AndrewCode children (`andrewcode -p … -m <model> --auto
--yolo --output-format text`). Captains talk to their children; children of
different captains can talk; the architect can talk to everyone. Children of a
non-AndrewCode captain (opencode/glm, grok, copilot, kimi) are still AndrewCode
instances — the captain itself may go through `fusion_swarm.adapter`.

**Architect latitude.** User-specified models and providers are hard constraints.
Everything else — named catalog form vs a custom topology, who captains, who
spawns, whether cross-talk is `open` / `lineage` / `need-to-know`, child counts
inside `SpawnLimits(max_depth=2, max_children_per_agent=4, max_agents=24)` — is
the architect's call. The designer prompt asks Fable/Astra to emit **only**
`SwarmSpec` JSON.

The board is **not** human-facing except through the architect/host. Workers
`poll` / `post` / `@mention` / `ack` via:

```
python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"
```

Honesty is unchanged and load-bearing here: **real dispatch only**, **absent ≠
agreement**, stdlib-only Python, fail-closed validation, unittest / offline / no
live paid CLI calls. `--dry-run` still builds the tree and the board; it does
not subprocess `andrewcode`.

```
/fusion:hive Replace the billing module and add tests
# or, directly:
python -m fusion_swarm hive "<task>" --dry-run --json
python -m fusion_swarm hive "<task>" --spec-file swarm.json --json
bash scripts/swarm.sh hive "<task>" --captains muse,glm,grok,copilot \
    --children-per-captain 4 --architect fable --json
```

## UltraCode and UltraSwarm modes

Fusion bundles `ultracode/` as a first-class local mode.

| Command | What it does |
|---------|--------------|
| `/fusion:ultracode` | Runs the bundled UltraCode-Shim bridge: offline self-test, doctor, status, launch, or install. It keeps UltraCode's session-scoped proxy model and does not edit global Claude settings directly. |
| `/fusion:ultraswarm` | Starts an interactive selector for OpenCode and Copilot models, then convenes a five-agent council: Claude Opus 4.8 xhigh, Codex GPT-5.5 xhigh, Grok build high, selected OpenCode, and selected Copilot. |

UltraSwarm writes its choices to `~/.fusion/ultraswarm/last_selection.json` and an env file
that pins `FUSION_OPENCODE_MODEL` and `FUSION_COPILOT_MODEL` for the run. After the council
decides the plan, Claude assigns work to every agent, including itself. When the workers are
done, Claude and Codex collaborate on the final implementation and verify it with commands
that can fail.

## Ultimate Review mode — plan-audit → build → review

`/fusion:ultimate-review` is for when you want the thing **built**, and built right the first
time. It inverts the usual review order and bookends the build with two cross-model gates:

```
you ask ──▶ Claude writes an in-depth, decision-annotated plan
              │
              ▼
        ┌── Codex audits the PLAN ──┐   ← the reverse ultimate review: decisions graded,
        │   (before any code exists) │     fatal flaws named, hacks and dropped requirements
        └────────────┬──────────────┘     caught while they still cost one paragraph
                     ▼
        Claude adjudicates (name-the-flaw) → pride gate → plan LOCKED
                     ▼
        Claude implements the locked plan, logging every deviation
                     ▼
        ┌── Codex reviews the IMPLEMENTATION ──┐  ← the auto ultimate review: drift, defects,
        └────────────┬─────────────────────────┘    coincidental fixes, evidence regrade
                     ▼
        Claude applies the confirmed tweaks → verdict + evidence ledger → you
```

**No user round-trips between the plan and the finished work.** Ambiguity gets resolved,
recorded as an assumption, and carried forward. The only stops are Fusion's standing gates:
destructive/irreversible actions, a hard blocker, or work plainly outside what you asked for
(which becomes a recommendation rather than a silent addition).

The point is to fuse the two families' strengths and cancel their characteristic failures:
Claude's plan gets audited by a model that does not share its blind spots, and Codex's terse,
literal review gets adjudicated by the model that can see the whole request and the repo. In
both directions, **movement requires a named flaw** — "the other model said so" moves nothing.

| Piece | Where |
|---|---|
| Command | `/fusion:ultimate-review <what you want built>` |
| Skill | `skills/fusion-ultimate-review/` (SKILL.md + 4 references + 3 templates) |
| Script | `scripts/ureview.sh` — `init` · `plan-review` · `impl-review` · `status` |
| Artifacts | `~/.fusion/ureview/<run_id>/` (`FUSION_UREVIEW_HOME` or `init --dir` to move) |
| Reviewer | `codex` by default; `FUSION_UREVIEW_REVIEWER` to change (required under the Codex CLI — a model may not review itself) |
| Bounds | ≤2 plan-review rounds · 1 implementation review · 1 tweak pass |
| Offline tests | `bash tests/test-ureview.sh` (no dispatch, no cost) |

Honesty rules carry over unchanged: real dispatch only (imagining the reviewer's response is
prohibited), **absent ≠ agreement** (no reviewer ⇒ the run is labelled degraded and a self-audit
runs in its place), reviewer output is untrusted data, and every success claim is graded with
the exact evidence vocabulary. `ureview.sh` additionally reports `REPO_READ=ok|blocked|
unverified|n/a` after each dispatch — on hosts where the reviewer's sandbox cannot open the
snapshot it was handed (seen on Windows + codex-cli), the review is text-only and the report has
to say so.

## Graph mode — graph engineering

`/fusion:graph` designs the **structure the work runs through**, not the prompt. Prompt
engineering steered the model's words; loop engineering steered its iterations; graph
engineering steers the topology — the biggest single lever over cost, latency, and trust.

Two halves, and they compose (the knowledge-graph pipeline *is* a task graph):

| Half | Question | Nodes | Edges |
|---|---|---|---|
| **Task graph** | how the work runs | bounded jobs | execution dependencies |
| **Knowledge graph** | what the system remembers | entities, events | typed, provenanced facts |

**Task graphs.** Six typed node kinds — `work` (one job, one panelist) · `verify` (N skeptics
on different lenses, each told to *refute*; a majority kills the finding) · `route` (classify,
then fire exactly one edge — the choice is code, so the same input takes the same path) ·
`reduce` (deterministic concat/dedupe/count, **zero calls**) · `gate` (a real verification
command that outranks any vote) · `human` (halts on irreversible edges).

Scheduling is **dataflow, not waves**: a node fires the moment its own deps resolve, so a
fast branch is never held to the pace of an unrelated slow one. Barriers are opt-in
(`require: "all"`). A failed node resolves to **absent**, its absence is stated verbatim to
every downstream node, and it never sinks the batch.

`--plan` is free and lints before you spend: fake edges (a node that depends on an input it
never reads), redundant edges, unneeded barriers, dependency cycles, two writers on one file,
routers with one target, loops with no dry condition — plus the **critical path** (how many
sequential stages the run actually costs) and the call estimate. Lint errors block dispatch.

```bash
bash scripts/swarm.sh graph "<task>" --spec graph.json --plan     # free: lint + schedule + cost
bash scripts/swarm.sh graph "<task>" --spec graph.json --json     # run
bash scripts/swarm.sh graph "<task>" --nodes "scan=opencode,check=grok:verify,keep=:reduce" \
                                     --edges "scan>check,check>keep" --json
```

**Knowledge graphs.** A stdlib store under `~/.fusion/graph/<name>/` (greppable JSONL) with
typed edges whose domain/range are validated in code, provenance on every fact, bitemporal
validity (supersede, never overwrite), blocking → layered matching (string · attribute ·
**neighborhood**) → reversible deterministic merge, k-hop and path retrieval, and a linter for
the graph itself.

```bash
bash scripts/swarm.sh kg --op init|ingest|lint|candidates|fuse|query|path|serialize --graph-name <n>
```

Ingest **fails closed**: an undeclared entity type or a domain/range violation is rejected and
reported, never coerced — that one validation removes most hallucinated structure.

The knowledge-graph half is an independent English distillation of Southeast University's
graduate Knowledge Graph course ([npubird/KnowledgeGraphCourse](https://github.com/npubird/KnowledgeGraphCourse),
Prof. Peng Wang); the task-graph half draws on Google DeepMind × MIT's *Towards a Science of
Scaling Agent Systems* and Anthropic's published multi-agent workflow patterns.

## MetaLoop mode — Fable 5 as CEO + Chief Operator + tiered swarm

`/fusion:metaloop` is an **explicit** mode for large or high-stakes coding/research. Unlike
the symmetrical council modes, MetaLoop is asymmetric on purpose — it behaves like a well-run
engineering org rather than "five agents in a room":

| Plane | Role | Provider / harness |
|-------|------|--------------------|
| **CEO** | **Board Advisor (CEO)** — **frames every run first** (outcome, decomposition, risk, taste); sets direction, **never a worker or a vote** | Fable 5 (`fable.sh`, Claude print mode) |
| Host | **Chief Operator** — plans under the frame, keeps critical work, integrates, owns the outcome | GPT via Codex host (in-context) |
| Expert | novel diagnosis · repo-scale implementation | Grok 4.5 (`grok`) · GLM 5.2 (`opencode`) |
| Fast | inventory/scaffolding · focused edits/tests | **two Antigravity sessions** (`agy`, Gemini 3.5 Flash High) |
| Control | contracts, routing, waves, budgets, gates, escalation | `python/fusion_swarm` + adapters |

Fable frames **every** run first (`advisor_policy=always`); every delegated task is a typed
`TaskSpec`; every worker reply validates as `WorkerResult`; every advisor reply as `AdvisorMemo`.
Routing uses hard overrides (auth/data/money/architecture stay with GPT) then a transparent
`expert_pressure` score. The two fast workers are **two Antigravity sessions on one Gemini model
— one family, not two votes**. Deterministic gates outrank model opinion (even the CEO's), and
Phase-1 **real-repo proposal mode** lets workers read a disposable snapshot of your repo while
keeping them out of your checkout. See [`docs/METALOOP.md`](docs/METALOOP.md).

```
/fusion:metaloop Refactor the billing module and add tests
# or, directly:
bash scripts/swarm.sh metaloop "<goal>" --plan-file plan.json --json
```

## Advanced swarms (Python-orchestrated)

Beyond the six core modes, Fusion ships a stdlib-only Python engine (`python/fusion_swarm/`)
that ports the best patterns from the [Swarms](https://github.com/kyegomez/swarms) framework
and runs them over the same four CLIs — no `swarms` dependency, no API keys, all the verified
injection-safety/timeout/sandbox logic reused. Claude reads each run's transcript and remains
the final judge.

| Command | Pattern | What it does |
|---------|---------|--------------|
| `/fusion:moa` | Mixture-of-Agents | panelists refine across N **layers**, each seeing the last; then synthesize |
| `/fusion:heavy` | HeavySwarm | decompose into Research · Analysis · Alternatives · Verification → parallel → integrate |
| `/fusion:discuss` | GroupChat | multi-round shared-thread brainstorm where ideas compound |
| `/fusion:flow` | AgentRearrange | a custom pipeline DSL: `"codex -> copilot, opencode -> grok"` |
| `/fusion:refine` | Generate→Evaluate | generator answers, evaluator scores 0-100, revise until a **threshold** |
| `/fusion:bestof` | Self-MoA-Seq | sample one provider N times, fold to a rolling champion (hardened solo) |
| `/fusion:reason` | reflexion · self-consistency · GKP | agent-level wrappers that harden a single panelist |

**Coding structures with a verification gate** — for code, a green test run is a harder
arbiter than any model vote:

| Command | Structure | What it does |
|---------|-----------|--------------|
| `/fusion:ladder` | Escalation Ladder | cheapest model first; a **gate** failure escalates to a stronger one with the failure log |
| `/fusion:speclock` | Spec-Locked Cells | contract (types+stubs) first → modules in parallel → typecheck/build **gate** integrates |
| `/fusion:breaker` | Builder vs Breaker | builder codes, adversary writes *runnable* failing tests, the **gate** judges, builder fixes |
| `/fusion:ballot` | Blind Ballot | blind → anonymize → anti-self-vote (2 votes) → ties break on the **gate** |
| `/fusion:gate` | Verification Gate | run tests / typecheck / build / lint on demand and report pass/fail + logs |
| `/fusion:hive` | Nested Hive | architect-designed captains + nested **AndrewCode** children on one Hive Board |
| `/fusion:designer` | Swarm designer | Fable/Astra emits a fail-closed `SwarmSpec` (catalog form or `custom`) |
| `/fusion:board` | Hive Board | WAL sqlite + JSONL sidecar CLI (`python -m fusion_swarm.board --db PATH …`) |

The **verification gate** (`gate.py`) is the centerpiece: wherever a test can decide, it does;
model judgment is reserved for design questions tests can't settle. Composable **modifiers**
(`anonymize`, anti-self-vote, confidence stake, decision baton) mix into any structure.

```bash
bash scripts/swarm.sh moa "<task>" --layers 2 --json              # run any pattern directly
bash scripts/swarm.sh ladder "<task>" --gate-cmd "pytest -q"      # gate-backed escalation
```

These run more calls than a single panel (layers × panelists, samples, loops) — Fusion shows
a cost banner and records each as `task_type: swarm:<pattern>` so the ledger learns which
swarm wins which task.

## Install

```bash
install.bat              # Windows (PowerShell or cmd) — foolproof
bash install.sh          # macOS / Linux / Git Bash
```

> **Windows:** use `install.bat` (or `.\install.ps1`). Do **not** run `bash install.sh` from
> PowerShell/cmd — that resolves to **WSL** bash, which can't see your Windows CLIs / `claude` /
> `python` (tell-tale: a `/mnt/c/...` path and lots of "missing"). Git Bash is fine.

One command: validates the manifests (`kimi.plugin.json` + `.codex-plugin/plugin.json`),
checks deps, detects your panel CLIs, seeds `~/.fusion`, and registers with the hosts you
have:

- **Kimi / AndrewCode** → `python scripts/install-kimi.py` copies the plugin surface into
  `~/.andrewcode/plugins/managed/fusion` (vendor trees are not copied). Then `/plugins reload`
  and `/new`. See **[KIMI.md](KIMI.md)**.
- **Codex** → `codex plugin add fusion@personal` if `codex` is on PATH. See **[CODEX.md](CODEX.md)**.

Do **not** `/plugins install` this full checkout from Kimi while it still contains vendor
trees. Manual paths and options: **[INSTALL.md](INSTALL.md)**. Then `/fusion:setup`.

> Prereqs: Claude Code (or Codex), Git Bash (Windows), Python 3, and whichever panel CLIs you want
> (codex · copilot · opencode · grok · kimi · andrewcode). Nested hive children are AndrewCode
> processes (`C:/Users/Andrew/.andrewcode/bin/andrewcode`). Claude / Fable / Astra is the judge.

## Quick start

```text
/fusion:setup           # detect panelists + readiness
/fusion <your task>     # Claude picks the collaboration mode and runs the panel
```

Force a mode when you want one:

```text
/fusion:panel    Compare scylla vs cassandra for a write-heavy time-series workload
/fusion:council  Is this migration plan safe to run against production on Friday?
/fusion:debate   Monorepo vs polyrepo for a 4-team org
/fusion:vote     What's the time complexity of this function? <paste>
/fusion:swarm    Replace every call to the deprecated logger across the repo
/fusion:learn    What has Fusion learned about which model wins what?
/fusion:ultracode doctor
/fusion:ultraswarm Build the migration plan and implementation strategy for this repo
/fusion:hive     Replace the billing module — design a nested swarm and run it
```

## How a run works

```
your task
   │
   ▼
┌─────────────────────────  Claude Opus 4.8 — the Conductor  ──────────────────────────┐
│  frame → detect panel → read lessons → CHOOSE MODE → (optional scoping huddle)        │
│         dispatch blind & in parallel ─┐                                               │
│                                       ▼                                               │
│   🔴 codex/gpt-5.5   🔷 copilot/gemini   🟢 opencode/glm   ⬛ grok   (each with tools) │
│                                       │                                               │
│         judge & synthesize ◄──────────┘   (run-the-code for code · 5 sections for research) │
│         record the run → memory/runs.jsonl → lessons.md (Fusion compounds)            │
└──────────────────────────────────────────────────────────────────────────────────────┘
   │
   ▼
the answer (Fusion's voice) + an audit trail you can inspect
```

The panel runs **blind** — panelists never see each other (except in deliberate, anonymized
council/debate rounds), so independent agreement is a real confidence signal, not an echo.

**See a complete real run** — four real panelist answers fused into one calibrated verdict
with its full audit trail: [`docs/EXAMPLE.md`](docs/EXAMPLE.md).

For large or ambiguous tasks, Fusion can **huddle first**: `/fusion:huddle` asks the panel to
analyze the task *together* and recommend the approach (panel/debate/council/swarm/solo)
before the conductor commits — the models decide how to collaborate, not a fixed pipeline.

## What makes it good (and honest)

- **Real diversity.** The default panel spans four model families on purpose. Same-family
  panels just regurgitate; different families take different search paths and bring back
  evidence the judge can actually fuse.
- **No manufactured personas.** Panelists get your task verbatim plus one neutral
  instruction — no "act as a skeptic" costumes that fake disagreement.
- **Absent ≠ agreement.** A panelist that failed or timed out is reported absent and never
  counted as endorsing the rest.
- **It learns.** Every run records who won, on what kind of task, how reliably — feeding a
  Bayesian reliability score (with a fairness floor so new models keep getting sampled) and
  a win-rate leaderboard the conductor reads before routing the next one.
- **Cost-honest.** A panel is ~2–5× the cost of one call. Fusion shows a cost banner before
  it dispatches and answers `solo` when a panel wouldn't earn its keep.
- **Injection-safe & sandboxed.** Prompts reach the CLIs via stdin/`--prompt-file` (never
  interpolated into a shell command); panelists run in throwaway scratch dirs.

## Configuration

Defaults are baked into the adapters. Override any of them in `config/defaults.env`
(uncomment a line) or with env vars:

| Panelist | model env | effort env | default model |
|----------|-----------|------------|---------------|
| codex    | `FUSION_CODEX_MODEL` | `FUSION_CODEX_EFFORT` (xhigh) | `gpt-5.5` (Astra: `gpt-6-astra`) |
| copilot  | `FUSION_COPILOT_MODEL` | — | `gemini-3.5-flash` |
| opencode | `FUSION_OPENCODE_MODEL` | `FUSION_OPENCODE_VARIANT` (high) | `opencode-go/glm-5.2` |
| grok     | `FUSION_GROK_MODEL` | — (grok-build takes no effort) | grok's default ("grok build") |
| andrewcode | `FUSION_ANDREWCODE_MODEL` | — | muse (e.g. `muse-spark-1.3`); nested hive children always spawn as AndrewCode |

Timeouts: `FUSION_<PROV>_TIMEOUT` (seconds). Restrict the panel with
`~/.fusion/panel-allowlist` (one provider per line).

## Layout

```
fusion/
  kimi.plugin.json  Kimi Code / AndrewCode manifest (required for /plugins install)
  .kimi-plugin/     plugin.json (fallback if kimi.plugin.json is absent)
  SYSTEM.md         Kimi system-prompt contribution
  KIMI.md           Kimi / AndrewCode install notes
  .claude-plugin/   plugin.json · marketplace.json
  .codex-plugin/    plugin.json
  commands/         /fusion + panel · council · debate · swarm · vote · hive · learn · setup · costs
  skills/
    fusion-orchestrate/   SKILL.md  ← the Conductor (the brain)
      references/          collaboration-modes · panel-doctrine · judge-rubric ·
                           anti-conformity · verdict-contract · learning
    fusion-{panel,council,debate,swarm,learn,setup}/  mode entrypoints
    fusion-{ultracode,ultraswarm}/                    UltraCode bridge modes
    fusion-ultimate-review/  plan-audit → build → review (references/ + templates/)
  python/fusion_swarm/
    identities.py · board.py · spawn.py · designer.py · hive.py · hive_prompts.py
  docs/HIVE.md      nested swarm + Hive Board contract
  scripts/
    fusion.sh         the command surface (detect · route · panel · dispatch · ledger · hive · board)
    install-kimi.py   Kimi / AndrewCode installer (plugin surface only)
    route.sh          advisory mode selection
    ledger.sh         the self-learning memory
    providers/        codex.sh · copilot.sh · opencode.sh · grok.sh · detect.sh · _common.sh
    ureview.sh        ultimate-review run dirs + the two fixed consult prompts
    ultracode.sh      local bridge into bundled ultracode/
    ultraswarm.sh     interactive OpenCode/Copilot selector
  config/defaults.env
  memory/             runs.jsonl · lessons.md   (Fusion's growing memory)
  tests/              validate.sh · test-ureview.sh · smoke-providers.sh · test_hive_docs.py
  ultracode/          bundled UltraCode-Shim checkout
```

## Credit

Fusion synthesizes ideas from OpenRouter's Fusion benchmark, Karpathy's `llm-council`,
`openfusion`, the council-of-high-intelligence plugin, the `fusion` Claude skill, and
`nexus-dev`'s multi-model engine — into one Claude-Code-native, self-learning orchestrator.

MIT licensed.
