# Collaboration modes

Ways the panel can work together — six core, plus `ultraswarm`, `graph`, `ureview`,
`hive`, and `designer`. You pick one (or compose them). Each entry gives
the *when*, the *exact mechanic*, and the *cost shape*. The default panel is the
live non-host CLIs; you (Codex) are always the judge/synthesizer except in `hive`,
where a frontier architect (fable / Astra) talks to the human and captains/workers
talk on the Hive Board.

For **large coding swarms** the default is: architect (fable / Codex `gpt-6-astra`)
**designs** (`designer`), `hive` **executes** nested andrewcode workers, and the
Hive Board is the comms fabric.

Glyphs: 🔵 codex(judge/host) · 🔴 codex(optional external) · 🔷 copilot · 🟢 opencode · ⬛ grok.

---

## 1. `solo` — answer alone
**When:** trivial, saturated, or you are already certain; the cost of a panel exceeds the
cost of being wrong. Also the honest fallback when <2 panelists are live.
**Mechanic:** just answer. Label the run `solo`. Record it (mode=solo, no panelists).
**Cost:** 1×. *Do not* dress a solo answer up as a council.

---

## 2. `panel` — blind fan-out → fuse (the canonical Fusion)
**When:** open-ended research, "how should I…", or a code task with one clear deliverable.
This is the default for most fusion-worthy tasks.
**Mechanic:**
1. Build the panel prompt (`panel-doctrine.md`): task verbatim + fixed neutral instruction.
2. `fusion.sh panel <prompt_file> <out_dir>` — all panelists run **blind and parallel**.
3. Read the status line. Mark non-returning panelists **absent**.
4. Judge (`judge-rubric.md`): Track A (run-the-code-and-merge) for code, Track B
   (five-section synthesis) for research.
5. Optionally add **one** separate Codex subagent as an extra viewpoint when the host
   exposes subagents; keep it out of your judging context and label it host-native.
**Cost:** panel (N calls) + your synthesis. ~2–5× a single call.

---

## 3. `council` — deliberate over rounds
**When:** a high-stakes, open decision where you specifically want disagreement surfaced
and pressure-tested, not averaged away.
**Mechanic (3 rounds):**
1. **R1 — blind analysis.** `fusion.sh panel` with the task + "give your independent
   analysis and recommendation (≤350 words)." Collect.
2. **R2 — anonymized cross-examination.** Relabel R1 answers **A/B/C/D** (strip who-said-
   what; keep the map yourself). Re-dispatch to each panelist: "Here are the other
   anonymized analyses. Where are they wrong, where right? Engage ≥2 by label." Append the
   verbatim anti-conformity directive (`anti-conformity.md`). Collect.
3. **R3 — crystallize.** Re-dispatch: "Final position in ≤120 words. No new arguments."
4. **Chair synthesis = you.** De-anonymize, weigh, and write the verdict. If agreement is
   suspiciously high (>~70%), force a counterfactual: ask the two strongest dissenters (or
   construct the steel-man yourself) "what would have to be true for the majority to be
   wrong?" before you commit.
**Cost:** ~3× panel + synthesis. Reserve for decisions that deserve it.

---

## 4. `debate` — adversarial two-sider
**When:** a contested either/or (A vs B, ship vs wait, monorepo vs polyrepo) where the
*tension* is the signal.
**Mechanic:**
1. Pick two strong, distinct panelists (different families). Assign **opposing positions**
   — this is the one place a "stance" is legitimate, because it's adversarial by design,
   not a costume.
2. **K rounds (1–3):** each side argues, then revises after seeing the other's last
   argument (re-dispatch with the peer's text). Keep the prior answer if a round fails.
3. **You adjudicate:** name the strongest point on each side, the cruxes they actually
   disagree on, and a decision *with* its kill criteria. Don't split the difference for
   politeness — pick, and say why, and say what would change your mind.
**Cost:** 2 panelists × K rounds + adjudication.

---

## 5. `vote` — model-free consensus (cheap, for verifiable answers)
**When:** the answer is a single checkable value — a number, a yes/no, one option, a
short fact. Synthesis would only blur it.
**Mechanic:**
1. `fusion.sh panel` (the panelists answer normally).
2. Extract each panelist's **answer key**: the last number (strip `$`/`,`) for math, else
   the normalized last non-empty line. (This is what `openfusion vote.py` does.)
3. Majority wins; tie-break by panel order. Report the **agreement ratio** as confidence.
4. If the vote is split, *escalate* to `panel` synthesis to reconcile — a split vote means
   it wasn't as verifiable as it looked.
**Cost:** panel, **no judge call**. The cheapest fusion. Use `ranked` instead when you want
the single best *full* answer (one tiny judge pass that returns just an index) rather than
a synthesized merge.

---

## 6. `swarm` — decompose and divide labor
**When:** large or parallelizable build/research work — many files, many independent
sub-questions — where having everyone answer the whole thing is wasteful.
**Mechanic:**
1. **Decompose** the task into independent subtasks with dependencies (you do this).
2. **Route** each subtask to the best-suited panelist (codex→implementation/refactor,
   copilot→breadth/long-context, opencode→cheap drafts/volume, grok→realtime/web, you→glue
   and anything needing repo context). Use `lessons.md` win-rates to break ties.
3. **Execute in dependency waves** — independent subtasks run in parallel
   (`fusion.sh dispatch` per subtask, backgrounded), dependent ones wait.
4. **Synthesize** the subtask outputs into one coherent deliverable (you), then **run/verify**
   it end to end. A swarm that produced parts you never assembled and ran is not done.
**Cost:** ~one call per subtask + synthesis. Scales with decomposition, not panel size.

---

## 7. `ultraswarm` — UltraCode-flavored council
**When:** the user explicitly asks for Fusion UltraSwarm, or a large coding/research task
needs both explicit model selection and council-before-execution. This is heavier than a
plain swarm; use it when the upfront deliberation is worth the extra calls.
**Mechanic:**
1. The skill presents model lists (with easy defaults: glm-5.2 + gemini-3.5-flash). User replies with choices (or "default"). The skill persists via `ultraswarm_selector.py --non-interactive`. No need to run the old interactive script from inside the agent.
2. Roster: Codex host as judge, Grok build high, selected OpenCode, selected Copilot,
   and optional external Codex CLI only when `FUSION_HOST=none`.
3. Convene a council round about framing, risks, and division of labor before anyone solves.
4. Codex assigns concrete tasks to every agent, including Codex's own task.
5. Dispatch worker tasks with the selected `FUSION_OPENCODE_MODEL` and
   `FUSION_COPILOT_MODEL` values.
6. After all agents finish, Codex integrates the final solution and runs checks that can fail.
**Cost:** selector + council + worker calls + Codex integration. Confirm before large
fan-outs.

---

## 8. `graph` — make the topology explicit

**When:** the *shape* of the work is the problem, not the prompt. Fan-out over N files or
sources where each finding must survive verification before it is reported; a pipeline whose
stages you suspect are needlessly sequential; routing by classification; discovery of unknown
size that should loop until it goes dry. Also the mode for the **memory** side — building or
querying a knowledge graph (ontology, extraction, entity resolution, GraphRAG).
**Mechanic:** load the **`fusion-graph`** skill. In short:
1. Draw nodes (bounded jobs) and edges — an edge only where data actually crosses it.
2. `swarm.sh graph "<task>" --spec graph.json --plan` — **free**. It lints fake edges, cycles,
   unneeded barriers, two-writers-one-file, and reports the critical path + call estimate.
   Lint errors block dispatch, so a malformed topology costs nothing.
3. Run it. Typed nodes: `work` · `verify` (skeptics that refute) · `route` (fires one edge) ·
   `reduce` (deterministic, 0 calls) · `gate` (a real check that outranks any vote) · `human`
   (halts on irreversible edges).
4. You judge what returned. Absent nodes are stated to downstream nodes and to the user.
**Cost:** exactly what `--plan` says. The critical path is the latency, not the node count.
**Do not use it** when the work is genuinely sequential — every multi-agent configuration
loses on work where each step needs the full picture. That is the stop rule; `panel` or
`solo` is the honest answer there.

---

## 9. `ureview` — plan-audit → build → review (Ultimate Review)

**When:** the user wants the thing *built*, and built right the first time — a feature, a
refactor, a migration, anything where a wrong early decision is expensive to unwind. Unlike
every mode above, the panel does not produce candidate answers: one reviewer audits **your
plan** before code exists, and **your implementation** after it does.
**Mechanic:** load the **`fusion-ultimate-review`** skill. In short:
1. `ureview.sh init "<task>"` → a run dir. Write an in-depth, decision-annotated plan.
2. `ureview.sh plan-review` → the **reverse** ultimate review: the other family grades every
   decision (confidence · origin · blast radius), names fatal flaws, input-dimensioned hacks,
   dropped requirements, and verification gaps — before a line is written.
3. Adjudicate under the name-the-flaw rule, revise, pride-gate the plan, lock it. Cap: 2 rounds.
4. Implement the locked plan, logging deviations as new append-only decisions.
5. `ureview.sh impl-review --repo "$PWD"` → a fast final review; apply confirmed tweaks; stop.
**Cost:** 2 reviewer calls + the build. **No user round-trips** between plan and delivery.
**Do not use it** for a question, a quick lookup, or a one-line change — the two gates cost more
than the work. And when the open *decision* (not the plan) is what's shaky, `council` is the
better instrument; `ureview` assumes the direction is settled and the execution is the risk.

---

## 10. `hive` — nested andrewcode swarm on one Hive Board

**When:** a large coding swarm that needs real nested processes, not a one-shot
panel. Captains of different families each spawn children; captains talk to their
children; children of different captains can talk; the architect can talk to
everyone. Example: a 4-captain swarm where muse-spark-1.3 and glm-5.3 each spawn
4 children.

**Mechanic:**
1. If there is no SwarmSpec yet, take the `designer` path first (or load a
   `spec_file`). Do not invent a topology in the judge context and pretend a
   frontier architect designed it.
2. `python -m fusion_swarm.hive` (or `fusion_swarm.hive.run(...)`) creates a
   Hive Board at the state dir, registers architect / operator / captains,
   ensures default rooms (`hive`, `architect`, `captains`, `workers`, `system`)
   plus `lineage-<captain>` and `task-main`, posts the task, and spawns children
   as **real AndrewCode processes**:
   `andrewcode -p … -m <model> --auto --yolo --output-format text`
   (Git Bash-safe; `FUSION_BOARD`, `FUSION_AGENT_ID`, `FUSION_PARENT_ID`,
   `FUSION_SWARM_ID` in the env). Children are andrewcode identities even when
   the captain is opencode/glm/grok/copilot/kimi — the captain model is passed
   as `-m` only when `spawn_via=andrewcode`.
3. Communication is **one Hive Board**: SQLite WAL + sibling JSONL, no daemon.
   Agents poll, post, DM, reply, @mention via
   `python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"`
   (and `post` / `dm` / `reply` / `mentions` / `ack` / `join`). The board is
   **not human-facing** except the architect/host. Workers post progress,
   @mention peers when they need them, and **never talk to the human**.
4. Depth and spawn budget are fail-closed (`SpawnLimits`: max_depth=2,
   max_children_per_agent=4, max_agents=24) **before** spawn.
5. `dry_run=True` still builds the tree + board and seeds posts; it does **not**
   subprocess. Live path: real dispatch only. Absent ≠ agreement.
6. Result: `pattern=hive`, `run_id`, `board_path`, `spec`, `agents`, `tree`,
   `posts_seeded`, `dry_run`. You (or the architect) synthesize from the board,
   not from imagined worker output.

**Cost:** architect + N captains + nested workers (default 4 children per
captain). Confirm before large fan-outs. Tests never call live paid CLIs.

**Do not use it** for a single checkable fact (`vote`), a one-shot research
question (`panel`), or a plan-audit-then-build gate (`ureview`). Hive is the
nested coding swarm.

---

## 11. `designer` — frontier architect invents the topology

**When:** the catalog form is not obvious, the user asked a frontier architect
to design the swarm, or the task is a large coding swarm whose shape should not
be frozen by the conductor. This is the path **before** `hive` (and before any
custom catalog form) when Fable 5.1 and/or Astra via Codex `gpt-6-astra` should
talk to the human and emit the spec.

**Mechanic:**
1. Build `design_prompt(task, live_roster, constraints)` — the architect emits
   **only** SwarmSpec JSON (markdown fences tolerated). Latitude to invent a
   `custom` topology if catalog forms don't fit.
2. Catalog of named forms (at least): solo, panel, council, debate, vote, swarm,
   hierarchy, metaloop, moa, heavy, discuss, graph, ladder, speclock, breaker,
   ballot, factory, diamond, nested-hive, ultraswarm, ureview, custom.
3. Each Topology: `name`, `when`, `mechanic`, `communication`
   (blind|board|lineage|open), `nesting`, `default_captains`,
   `default_children`, `cost_shape`.
4. SwarmSpec (fail-closed): `name`, `architect` (provider+model), `operator`,
   `captains` (`id`, `provider`, `model`, `spawn`, `spawn_via`), `cross_talk`,
   `board`, `max_depth`, `max_children_per_agent`, `max_agents`, `budget`,
   `communication` (open|lineage|need-to-know), `task`, `notes`.
5. `parse_swarm_spec(text) -> SwarmSpec`; `validate_spec(spec, live_roster) ->
   list[str]` fail-closed. User-specified models/providers are **hard
   constraints**; everything else is the architect's call.
6. Hand a valid spec to `hive` (nested execute + board) or to the named catalog
   mode. In tests, return the design packet (prompt + roster) rather than
   calling live models.

**Cost:** 1 architect call, then whatever the emitted spec costs. Do not skip
validation and do not silently rewrite user-pinned providers.

---

## Composing modes
Modes nest. A `swarm` subtask can itself be a `panel`. A `council` can open with a
`vote` to see if there's even disagreement worth deliberating. A `debate` can feed its
two positions into a final `panel` for a reconciled synthesis. For large coding
swarms, compose `designer` → `hive`: the architect emits SwarmSpec, hive executes
it on the board. Compose when the task has structure; don't over-engineer a simple ask.

## The non-negotiables across every mode
- Panelists are **blind** to each other until you deliberately show them peers (council/
  debate rounds only), and then **anonymized**. Exception: `hive` uses the Hive Board
  (open / lineage / need-to-know per SwarmSpec) — still never invent an absent agent's
  post, and workers never address the human.
- **Absent ≠ agreement.** Recompute consensus over returning panelists only.
- **Tools on.** The lift comes from panelists doing real web/shell work and bringing back
  *different evidence*. A tool-free panel just regurgitates and dilutes — prefer `solo`.
- **Record every run.** No silent runs; the ledger is how Fusion compounds.
- **Hive honesty.** Nested workers are real `andrewcode` processes; `dry_run` must
  say so. Do not simulate board posts. The board is file+SQLite so independent
  processes can talk — no daemon.
