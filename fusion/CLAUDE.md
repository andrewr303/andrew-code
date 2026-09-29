# CLAUDE.md — developing the Fusion plugin

Repo-dev notes for working on Fusion itself (not installed with the plugin).

## What this is
A Claude-Code-native multi-model orchestrator. Claude Opus 4.8 is the **conductor, judge,
and synthesizer**; the four external CLIs (codex, copilot, opencode, grok) are the panel.
The skill prose *is* the program — the bash only moves bytes and keeps books.

## Architecture in one line
`skills/fusion-orchestrate/SKILL.md` (the brain) decides a collaboration mode → calls
`scripts/fusion.sh` verbs to detect/dispatch/record → reads the returned `.out` files and
synthesizes → records the run to `memory/runs.jsonl` so `lessons.md` sharpens the next run.
UltraCode-specific paths are bridged through `scripts/ultracode.sh`; UltraSwarm model
selection is handled by `scripts/ultraswarm.sh` and saved under `~/.fusion/ultraswarm`.

## Hard rules (don't regress these)
- **Conductor never simulates panelists.** Dispatch is real; a panelist with no `.out` is
  absent. The MANDATORY COMPLIANCE block in the orchestrate skill enforces this.
- **Judge stays off the panel** by default (no self-preference).
- **Absent ≠ agreement.** Consensus is over returning panelists only.
- **Injection-safe dispatch.** Prompts go to CLIs via stdin (`codex -`), `--prompt-file`
  (grok), or a single `"$(cat file)"` arg (copilot/opencode) — **never** interpolated into a
  double-quoted command string.
- **Diversity is real families.** Don't collapse the default panel to one vendor.
- **UltraCode stays session-scoped.** Do not edit global `~/.claude` settings or commit
  `ultracode/config.json` / `ultracode.env`.

## Verified CLI invocations (re-verify if a CLI updates)
| CLI | invocation (see `scripts/providers/<x>.sh`) | notes |
|-----|----------------------------------------------|-------|
| codex 0.141 | `codex exec --skip-git-repo-check -C <dir> -s <sandbox> -m gpt-5.5 -c 'web_search="live"' -c model_reasoning_effort=xhigh -o <out> -` | prompt on stdin; `-o` = last message only |
| copilot 1.0 | `copilot -p "<text>" --model gemini-3.5-flash --allow-all-tools -s --no-color -C <dir>` | `-s` = response only |
| opencode 1.17 | `opencode run -m opencode-go/glm-5.2 --variant high --format json --dir <dir> "<text>"` | parse JSON events for text |
| grok 0.2 | `grok --prompt-file <file> --output-format plain --always-approve --cwd <dir>` | **grok-build rejects `--effort` (HTTP 400)** — opt-in only |

## UltraCode / UltraSwarm integration
- `/fusion:ultracode` invokes `skills/fusion-ultracode` and the local bridge
  `scripts/ultracode.sh`. The safe gates are `test` (offline proxy self-test) and `doctor`.
- `/fusion:ultraswarm` invokes `skills/fusion-ultraswarm`. The selector loads OpenCode models
  first, then Copilot models, asks for the task/project, and writes:
  `~/.fusion/ultraswarm/last_selection.json` plus `.env`.
- Fixed UltraSwarm roster: Claude Opus 4.8 xhigh, Codex GPT-5.5 xhigh, Grok build high,
  selected OpenCode, selected Copilot.
- The council discusses approach first. Claude then assigns tasks to every agent, including
  itself. After all workers finish, Claude and Codex integrate and verify the final solution.
- If selector discovery falls back to defaults, report that honestly; do not claim complete
  live model discovery.

## Cross-platform notes (this was built on Windows/Git Bash)
- No GNU `timeout` on Git Bash → `_common.sh` ships a pure-bash `fusion_timeout`.
- Native CLIs need Windows paths for dir/file args → `fusion_winpath` (cygpath -w, no-op on POSIX).
- Adapters use `set -uo pipefail`; `"${arr[@]}"` on empty arrays is safe on bash 4.4+.

## Python swarm engine (`python/fusion_swarm/`)
Stdlib-only port of Swarms patterns (MoA, heavy, discuss, hierarchy, graph, flow, refine,
bestof, reflexion/self-consistency/gkp). **No dependency on the `swarms` package** — every
"agent call" shells out to the verified CLI adapters via `adapter.dispatch()` →
`fusion.sh dispatch`. Claude stays the final judge; a CLI aggregator is the standalone fallback.
- Entry: `python -m fusion_swarm <pattern> ...` (bridge: `scripts/swarm.sh`).
- **GOTCHA (cost me a real bug):** on Windows, Python's `subprocess.run(["bash",...])`
  resolves to **WSL bash** (`System32\bash.exe`, `uname=Linux`), which can't see the Windows
  CLIs → every dispatch returns 127/absent. `adapter._find_bash()` pins Git Bash explicitly
  (override via `FUSION_BASH`). Also: Python emits backslash paths; `adapter._fs()`
  forward-slashes every path handed to bash.
- Patterns return a dict (transcript + optional `synthesis`/`final`); the CLI records to the
  ledger as `task_type: swarm:<pattern>`.

## Graph engineering (`/fusion:graph` → `skills/fusion-graph`)
Two halves, one mode. `graph.py` is the **task-graph** engine; `kgraph.py` is the
**knowledge-graph** store. Both are stdlib-only and fully testable offline (`tests/test_graph.py`,
58 tests, no CLI dispatch — the stub swaps `graph.dispatch`).
- **Don't regress the scheduler back to waves.** `_run_once` waits on the *first* future to
  finish (`next(as_completed(...))`) and re-computes readiness per node. Wave scheduling — the
  original port's behavior — held every node to the slowest node in its level. There is a
  timing test for this (`test_dataflow_not_waves`); if you "simplify" the loop, it fails.
- `reduce`/`gate`/`human` nodes must stay at **zero dispatches** (`Node.dispatches()`); the
  call estimate, the budget cap, and the "don't pay an agent to flatten a list" rule all hang
  off that.
- The call cap is checked **at submit time in the main loop**, not inside the worker thread —
  a budget that is only enforced after spending is not a budget.
- `kgraph._eid()` keys a node on (type, name, **source**) on purpose: two sources saying
  "J. Smith" are two mentions until fusion says otherwise. Collapsing them at write time is an
  automatic erroneous merge, which is far worse than a missed one.
- `match_score` weights only the layers that carry evidence. Fixed weights capped an isolated
  identical-name pair below the reject floor purely for having no attributes/neighbors yet —
  the graph then never proposed the duplicates it most obviously had.
- Adding a `kg --op`: extend `kgraph.run()` **and** the `--op` help in `__main__`. `kg` and
  `gate` are the two engine patterns with an empty roster in `modes_catalog` (they dispatch no
  panelist) — keep it that way or the dashboard grows controls that do nothing.

## Ultimate Review (`/fusion:ultimate-review` → `skills/fusion-ultimate-review`)
Plan → cross-model plan audit → adjudicate + pride gate → implement → cross-model
implementation review → bounded tweak pass. `scripts/ureview.sh` is the bytes-mover;
`tests/test-ureview.sh` covers it offline (`--dry-run` builds the real prompt, skips dispatch).
- **The two consult prompts live in bash on purpose.** They are fixed contracts, not per-run
  reasoning — same rationale as `fusion.sh cmd_huddle`. If they drift into the skill prose, a
  review can be silently reworded run-to-run and the gate stops being comparable.
- **`REPO_READ` is load-bearing, not telemetry.** Handing `--repo` to a reviewer is not the
  same as it being able to read the snapshot: on Windows + codex-cli, the sandbox fails to
  launch a shell (`CreateProcessAsUserW failed`) in *both* `read-only` and `workspace-write`,
  so the snapshot mounts unreadable and the reviewer reviews prose while sounding like it read
  code. `repo_read_status()` greps the preserved `<out>.log` and reports
  `ok|blocked|unverified|n/a`. Don't "fix" a `blocked` by loosening the sandbox — paste the
  excerpts instead. (Same failure affects MetaLoop proposal mode on this platform.)
- **`init` resumes, it does not reset.** Re-running it on an existing run dir keeps `task.txt`
  and `decisions.md` — the task is the audit anchor embedded in both prompts, and the log is
  append-only. A different task means a different run dir.
- The bounds (≤2 plan rounds, 1 impl review, 1 tweak pass) are the termination proof. Two
  models that have each stated a named position twice converge on confidence, not truth.

## Testing
```
bash tests/validate.sh        # bash -n, json parse, frontmatter, grep-the-contract invariants
bash tests/test-ureview.sh    # offline ureview prompt-contract + guard tests (no dispatch)
python -m unittest discover -s tests -p "test_*.py"   # 178 offline tests, no CLI/network
bash tests/smoke-providers.sh # LIVE: one-word prompt to each panelist (costs a little, ~1–3 min)
```
`validate.sh` step [8] runs `tests.test_metaloop` and `tests.test_graph`; step [9] runs
`tests/test-ureview.sh`.
`validate.sh` greps the skill files for must-appear strings (anti-simulation, absent≠agreement,
the name-the-flaw directive, the verdict contract) — because the program is prose, ordinary
tests miss prompt regressions.

## When you change things
- Editing an adapter's flags → re-run `tests/smoke-providers.sh` against the real CLI.
- Editing the ledger schema → keep `references/learning.md` and the record example in sync.
- Adding a mode → update `references/collaboration-modes.md`, the route heuristics in
  `route.sh`, a mode skill + command, and `validate.sh`'s mode list.
