---
name: fusion-metaloop
description: >-
  MetaLoop — Fable 5 as CEO + an ACTIVE GPT Chief Operator (codex,
  gpt-5.6-sol @ xhigh, dispatched at plan/adjudicate/review points) + tiered
  swarm. Fable frames EVERY run first (strategy, decomposition, risk, taste);
  the Chief Operator plans, adjudicates worker results, and reviews integration
  under that frame; the in-context host executes and owns the tree; bounded
  tasks route to expert (Grok 4.5, OpenCode/GLM) and fast (two
  Antigravity/Gemini 3.5 Flash sessions) tiers; deterministic gates outrank
  model opinion. Workers read a real-repo snapshot in proposal mode — external
  workers never write the user's checkout.
---

# IMMEDIATE ACTION — NO DISCOVERY
When this skill activates, resolve `FUSION_PLUGIN_ROOT` from THIS `SKILL.md` path and run the engine scaffold in the very first step. Do NOT open by searching the disk for skill files or plugin caches.
- **Forbidden**: any `find ~`, `find ~/.codex`, `find ~/.claude`, broad `grep` of home, or "I'll start by locating…" shell commands. These hang on Windows/OneDrive and are unnecessary.
- Layout is fixed under the plugin root: `python/fusion_swarm/` and `scripts/`. First command (prints config, live roster with tiers, correlation groups) via the canonical bridge:
  ```
  bash "$FUSION_PLUGIN_ROOT/scripts/swarm.sh" metaloop "<one-line goal>"
  ```
  Add `--plan-file plan.json` once you have written a task DAG, to get routing decisions, dependency waves, and the advisor-preflight trigger. (`swarm.sh` sets PYTHONPATH and runs `python -m fusion_swarm`.)

# Fusion MetaLoop

MetaLoop is a **centralized plan-and-execute organization with a CEO who frames every run and an on-demand critic**, not a group chat. Roles are asymmetric on purpose.

| Plane | Role | Who | Job |
|---|---|---|---|
| **CEO** | **Board Advisor (CEO)** | Fable 5 (`fable` adapter) | **Frames EVERY run first** — sets the outcome, decomposition strategy, risk priorities, and quality/taste bar. Sets direction; **never a worker, never a vote.** |
| **Operator** | **Chief Operator (ACTIVE, dispatched)** | `codex` (GPT‑5.6‑sol @ xhigh) | **Dispatched at three mandatory points:** (1) builds the task DAG under the CEO frame, (2) adjudicates each wave's worker results, (3) reviews integration before final gates. Its OperatorPlan/OperatorVerdict outputs BIND the host unless overridden with recorded evidence. |
| Host | **Executor Host** | the in-context orchestrator (Claude in Claude Code; Codex in Codex CLI) | Runs the mechanics under the CO's plan: dispatches workers, applies proposals to the real checkout, runs gates, keeps the audit. The ONLY writer of the user's tree. |
| Expert | Expert A / B | `grok` (Grok 4.5) · `opencode` (GLM 5.2) | Novel diagnosis / adversarial review · repo-scale implementation / refactor |
| Fast | Fast A / B | **two `agy` sessions (Antigravity · Gemini 3.5 Flash High)** | Inventory, scaffolding, mechanical edits · focused edits, tests, docs |
| Control | Deterministic runtime | `python/fusion_swarm` + bash adapters | Contracts, routing, waves, budgets, gates, escalation, ledger |

**The org chart:** Fable is the CEO — it frames the run before any planning. The Chief Operator is **codex running gpt-5.6-sol at xhigh** and it is ACTIVE: when the in-context host is not Codex, the host MUST dispatch it at the three lifecycle points below — a MetaLoop run where codex was never dispatched is not a MetaLoop run (record it absent and say so). If the Codex CLI itself is the host, the CO role is host-native and the dispatches collapse in-context. **Fable sets direction but does not implement, dispatch, vote, or write code.** The two fast workers are **two Antigravity sessions running the same Gemini 3.5 Flash model** — they are one correlated family (throughput and execution diversity, never two independent votes). Copilot is **not** a MetaLoop worker.

**The single most important constraint:** even though Fable (CEO) frames every run, **deterministic verification still outranks every model opinion — including the CEO's.** A failing gate beats an approving CEO. Fable frames and advises; it never overrides a test.

## Lifecycle (host runs this in-context)

0. **Intake** — restate the outcome in one sentence; capture constraints, the destructive-action policy, and the expected verification.
1. **Context snapshot** — inspect the real repo (cwd, git status, base commit, dirty files, scripts, test/build commands) before inventing paths. Record available providers via the scaffold command above. Set `REPO="$(pwd)"` (the repo workers will read).
2. **Fable CEO framing (ALWAYS FIRST)** — before you plan, dispatch the CEO. This is mandatory on every run (`advisor_policy=always`):
   ```
   bash "$FUSION_PLUGIN_ROOT/scripts/fusion.sh" dispatch fable <packet.txt> <memo.json> "$FUSION_FABLE_MODEL"
   ```
   The reply must validate as **AdvisorMemo** (`decision` = approve|revise|stop). Treat its `required_changes` and `decomposition_findings` as **directives that shape your plan**, not optional critique. For every directive record exactly one of: adopted / partially_adopted / overridden (with evidence) / blocked. A `stop` decision halts the run before any work.
3. **Chief Operator plan (MANDATORY dispatch #1)** — send the CEO memo + context snapshot to codex and have IT build the plan:
   ```
   bash "$FUSION_PLUGIN_ROOT/scripts/fusion.sh" dispatch codex <co-packet.txt> <operator-plan.json> "$FUSION_CODEX_MODEL" "$FUSION_CODEX_EFFORT" "" "$REPO"
   ```
   The packet contains: the AdvisorMemo, repo facts, and the outcome. The reply must validate as **OperatorPlan** JSON: a typed task DAG where each delegated task is a `TaskSpec` (objective, risk profile 0..3, allowed/forbidden paths, acceptance criteria, verification_cmd, preferred_tier, fallback_chain, approval_level) plus `critical_path` tasks assigned to the host. The host may amend the plan only with recorded evidence (same discipline as CEO directives: adopted / partially_adopted / overridden). If codex is absent after the repair ladder, the host plans itself and records `operator: absent` in the audit.
4. **Freeze the plan** — apply/override advisor directives, freeze task contracts, compute dependency waves.
5. **Parallel labor waves (real-repo proposal mode)** — within a wave, dispatch external workers concurrently up to tier caps and do your own critical task in-context. Pass `REPO` as the 6th arg so each worker snapshots the repo for READ context (it edits only its disposable copy; YOU apply selected work in the real checkout):
   ```
   bash "$FUSION_PLUGIN_ROOT/scripts/fusion.sh" dispatch opencode <prompt> <out> "$FUSION_OPENCODE_MODEL" high "$REPO"   # expert B (GLM 5.2)
   bash "$FUSION_PLUGIN_ROOT/scripts/fusion.sh" dispatch grok     <prompt> <out> "$FUSION_GROK_MODEL"  ""   "$REPO"     # expert A (Grok 4.5)
   bash "$FUSION_PLUGIN_ROOT/scripts/fusion.sh" dispatch agy      <p1>     <o1>  "Gemini 3.5 Flash (High)" "" "$REPO"   # fast A (agy session 1)
   bash "$FUSION_PLUGIN_ROOT/scripts/fusion.sh" dispatch agy      <p2>     <o2>  "Gemini 3.5 Flash (High)" "" "$REPO"   # fast B (agy session 2)
   ```
   Each worker returns **WorkerResult** JSON. Workers use **proposal mode**: they return patches/artifacts; the host applies selected work in the real checkout. (Omit the `$REPO` arg for a blind, repo-less task.)

   **Field lessons (from live runs — bake these into every dispatch):**
   - **End every worker prompt with the exact return-schema line and "your reply MUST end with this JSON object".** Workers have returned prose/markdown instead of the contract; one host-side schema repair is cheap, but only if you asked for the contract explicitly.
   - **Snapshots can truncate.** `git ls-files` is alphabetical and the file cap (default 4000) silently drops late directories (`src/`, `supabase/` — observed live). The snapshot now writes `SNAPSHOT-TRUNCATED.md` with a read-only fallback path; still, tell workers in the prompt: "if the snapshot is missing directories, read the ORIGINAL checkout READ-ONLY at <path>".
   - **Adapters preserve diagnostics as `<out>.log` (and `.raw` for opencode).** When an output looks truncated or too small, read those before re-dispatching — exit 0 does NOT mean the answer completed (observed live: opencode narration-only replies, 273 bytes, rc=0).
   - **Scope expert reviews tightly** (≤4 files, findings-first, an explicit output budget). A whole-pipeline review timed out at 600s; the tightened-scope retry of the same review succeeded with high quality.
   - **Timeouts:** default worker timeout is 600s; heavy extraction/synthesis tasks need `FUSION_<PROV>_TIMEOUT` raised (1800s) BEFORE the first dispatch, not after the timeout burns an attempt.
6. **Per-task validation + CO adjudication (MANDATORY dispatch #2)** — the host parses the schema, confirms artifacts exist, runs the scope gate (changed paths vs allowed/forbidden), and runs local verification. Then send the wave's WorkerResults (+ the host's mechanical validation notes) to codex for adjudication; its **OperatorVerdict** (accept / reject / repair, per task, with reasons) drives integration. Findings that assert severity (SEV1/SEV2) from FAST-tier workers must carry host- or CO-verified evidence before any fix lands — fast-tier severity claims have been refuted live twice. A blank/timed-out/malformed/absent worker is **absent — not agreement and not negative evidence**.
7. **Bounded repair** — follow the ladder and stop at the caps: schema-repair retry → alternate worker (same tier) → fast→expert promotion → host takeover → Fable systemic consult → stop. Default `max_repair_rounds=2`, `max_attempts_per_task=3`.
8. **Integration + CO review (MANDATORY dispatch #3)** — the host applies accepted proposals to the real checkout, resolves conflicts deliberately, preserves architecture/scope, and runs cross-task checks. Before the final gates, send the integrated diff summary (git diff --stat + key hunks) to codex for the integration review; treat its findings like adversarial review output (verify, then adopt/override with evidence). Skip only when the run produced no code changes.
9. **Final deterministic gate** — run the strongest checks available (tests/typecheck/build/lint/acceptance). **When a gate and a model opinion disagree — including the CEO's — the deterministic failure wins.**
10. **Optional Fable final review** — only for high-risk / taste-heavy runs; it does not replace the gate.
11. **Publish + learn** — emit the deliverable and record the run:
    ```
    bash "$FUSION_PLUGIN_ROOT/scripts/fusion.sh" ledger record '<run json>'
    ```

## Hard rules (MetaLoop invariants)
- **Real dispatch only.** Never simulate or imagine a panelist's output. A panelist with no `.out` file is absent.
- **The Chief Operator is dispatched, never simulated.** Three mandatory codex dispatches per run (plan, adjudicate, integration review) when the host is not Codex. If codex is absent after the ladder, the host performs the role and the audit says `operator: absent` — silently absorbing the role is a contract violation.
- **CO output binds unless overridden with evidence.** Host overrides of OperatorPlan/OperatorVerdict are recorded exactly like CEO-directive overrides. Deterministic gates outrank the CO too.
- **Fable (CEO) frames every run, but is not a worker and not a vote.** It sets direction; keep it off the worker panel and out of any tally. Deterministic gates outrank it.
- **Absent ≠ agreement.** A dropped/failed/blank worker is reported absent; it never counts toward consensus.
- **The two fast workers are two Antigravity sessions on one Gemini model — one family.** Never present their agreement as two-model consensus; weight the Gemini family once. (Correlation-aware: same harness + same model = correlated.)
- **Deterministic verification outranks model opinion.** No "the models agree" (or "the CEO approved") when a test fails or evidence is missing.
- **Proposal mode preserves the no-user-tree-write invariant.** External workers read a disposable repo snapshot and return patches; only the host writes the real checkout. (Worktree isolation is Phase 2.)
- **Budgets are hard.** Stop at advisor, repair, attempt, call, and wall-time caps and report honestly (partial / blocked) rather than bluffing.
- **Human approval** is required before anything destructive, production, paid-large, or irreversible. Exact model IDs, attempts, fallbacks, and gate receipts appear in the final audit.

## Final output contract
Report: **outcome**, **CEO frame** (what Fable directed and whether you adopted it), **Chief Operator record** (the three codex dispatches: plan/adjudicate/review — what it directed, what the host overrode with evidence, or `operator: absent` + why), **plan summary**, **work allocation** (which model/harness did what — note the two agy sessions as one Gemini family), **verification** (exact commands + pass/fail), **known limitations**, and **audit** (model IDs, attempts, absent workers, fallbacks, workspace mode).
