---
name: fusion-swarm
description: >-
  Decompose a large or parallelizable task into subtasks, route each to the best-suited CLI,
  execute in dependency waves in parallel, then synthesize and verify one coherent
  deliverable. For large multi-file coding work, prefer hive nested-hive (architect
  designs, captains spawn real andrewcode children on one Hive Board) over flat
  dispatch; classic swarm remains available. Triggers: "swarm", "divide and conquer",
  "parallelize this", "split this across the models", "migrate everything", "nested hive".
---

# Fusion — Swarm

This is the **`swarm`** entrypoint. Load and run **`fusion-orchestrate`**.

**Pick the shape first.** For **large multi-file coding work** (migrations, broad
refactors, many independent files, nested labor), recommend **`hive` / `nested-hive`**
over a flat dispatch: a frontier architect (Fable 5.1 and/or Astra via Codex
`gpt-6-astra`) designs a SwarmSpec; captains (any live CLI) spawn **real AndrewCode
children** on **one Hive Board**. Classic `mode = swarm` (flat decompose → route →
waves) remains available for smaller or already-split work.

Unlike panel/council (everyone answers the *whole* task), a swarm splits the
task and gives each panelist a *piece* it's best at — cheaper and faster at scale.

## When to use hive nested-hive vs classic swarm

| Shape | Use when | How |
|---|---|---|
| **`hive` / `nested-hive` (recommended for large multi-file work)** | Many files, nested labor, captains that should spawn children, cross-talk between workers | Architect designs (`designer`); `python -m fusion_swarm.hive` executes. Captains = any live CLI. Children = real `andrewcode -p … -m <model> --auto --yolo --output-format text`. Comms = Hive Board (`python -m fusion_swarm.board --db "$FUSION_BOARD"`). `dry_run` still builds the tree + board. |
| **classic `swarm`** | Clean, already-independent subtasks; no nesting needed; you want one dispatch per piece | Decompose → route → waves via `fusion.sh dispatch`. You synthesize and verify. |

Honesty: real dispatch only; absent ≠ agreement; do not invent board posts or child output. Workers never talk to the human. Tests never call live paid CLIs.

## Mechanic — classic swarm (`references/collaboration-modes.md` §6)
1. **Decompose** (you): break the task into independent subtasks with explicit
   dependencies. If decomposition is itself uncertain, run a quick **scoping huddle** first.
2. **Route** each subtask to its best fit — break ties with `lessons.md` win-rates:
   - 🔴 codex → implementation, refactors, precise code
   - 🔷 copilot → breadth, long-context reading, synthesis-of-many
   - 🟢 opencode → high-volume cheap drafts, boilerplate
   - ⬛ grok → realtime / web-current facts
   - 🟣 andrewcode / muse → nested parallel implementation (preferred children under hive)
   - 🔵 you → glue, anything needing repo context, final assembly
3. **Execute in waves:** independent subtasks run in parallel (`fusion.sh dispatch` per
   subtask, backgrounded in one batch); dependent subtasks wait for their inputs. A subtask
   that fails retries on its next-best panelist (its alternate route).
4. **Synthesize + VERIFY** (you): assemble the pieces into one coherent deliverable and
   **run/test it end to end.** A swarm that produced parts you never assembled and ran is
   not done.

## Mechanic — hive nested-hive (recommended default for large coding swarms)
1. **Design** (optional but preferred): `design_prompt(task, live_roster, constraints)` →
   Fable/Astra emits **only** SwarmSpec JSON. User-pinned models/providers are hard
   constraints. Catalog form `nested-hive` when the work needs captains + children.
2. **Run hive:** create the board, register architect / operator / captains, ensure
   `lineage-<captain>` and `task-main`, spawn children as andrewcode identities
   (even if the captain is opencode/glm — children are andrewcode; captain model
   can be passed as `-m` when `spawn_via=andrewcode`). Post the task to the board.
3. **Talk on the board, not to the human.** Workers poll/post/DM/mention via
   `python -m fusion_swarm.board --db "$FUSION_BOARD"`. Cross-talk is allowed when
   the spec says so. Architect/host is the only human-facing seat. Workers
   **never talk to the human**.
4. **Verify** the assembled deliverable. `dry_run=True` builds the tree + board
   without subprocesses. Result: `pattern=hive`, `run_id`, `board_path`, `spec`,
   `agents`, `tree`, `posts_seeded`, `dry_run`.

## Guardrails
- **Cost gate:** swarms can fan out widely — estimate subtask count × cost (and nested
  children: default 4 per captain, `SpawnLimits.max_agents=24`) and **confirm
  with the user** before a large run.
- **Decompose-failure is silent:** if you can't cleanly split the task, say so and fall back
  to `panel` rather than faking parallelism. If the split is large and nested, escalate
  to `hive` rather than flattening it.
- Record the run (`mode=swarm` or `mode=hive`) with per-subtask routing so the ledger learns the routing.
