---
description: MetaLoop — Fable 5 as CEO + Chief Operator (GPT/Codex) + tiered swarm (Grok/OpenCode experts, two Antigravity/Gemini 3.5 Flash fast sessions). Fable frames EVERY run first; GPT plans and owns the outcome under that frame; deterministic gates outrank model opinion. Real-repo proposal mode by default.
argument-hint: [large coding/research task]
---

CRITICAL — DIRECT EXECUTION: Resolve `FUSION_PLUGIN_ROOT` from the loaded skill path and immediately run the engine scaffold with a *relative* path. NEVER begin with location searches (`find ~`, `find ~/.codex`, `find ~/.claude`, broad `ls`/`grep` of home) — they hang on Windows/OneDrive and are not needed. First command:

```
bash scripts/swarm.sh metaloop "<one-line goal>"
```

(Once you have a task DAG written to `plan.json`, add `--plan-file plan.json` to get routing decisions, dependency waves, and the advisor-preflight trigger. Use `--json` for machine-readable output.)

Invoke the **fusion-metaloop** skill.

The skill will:
- Print the MetaLoop config, the live roster with tiers (CEO / host / expert / fast), and the correlation groups.
- **Dispatch Fable 5 as CEO FIRST on every run** — it frames the outcome, decomposition strategy, risk priorities, and quality bar as an `AdvisorMemo`. Fable sets direction; it is never a worker and never a vote.
- Have GPT (the Codex host) plan a typed task DAG **under the CEO frame**, keep critical/cross-cutting work, and route bounded tasks to the right labor tier.
- Dispatch expert workers (`grok`, `opencode`) and the fast tier (**two `agy` sessions on Gemini 3.5 Flash**) through the verified adapters, in **real-repo proposal mode** — each worker reads a disposable snapshot of your repo and returns patches; only the host writes your checkout.
- Validate every worker reply as `WorkerResult`, run a deterministic gate that outranks model opinion (including the CEO's), and stop honestly at the advisor/repair/attempt/call/time budgets.

You can pass the task directly: `/fusion:metaloop Refactor the billing module and add tests`.

Key options (see `docs/METALOOP.md`): `--advisor always|auto|on-demand|off` (default **always** — Fable is the CEO), `--advisor-max N`, `--max-repair-rounds N`, `--expert-concurrency N`, `--fast-concurrency N` (two agy sessions), `--workspace-mode proposal`, `--risk-threshold N`, `--gate-cmd "<cmd>"`.

Hard rules (same as the rest of Fusion): real dispatch only; absent ≠ agreement; the two fast workers are two Antigravity sessions on one Gemini model — one family, not two votes; deterministic verification beats model opinion (even the CEO's); ask before anything destructive, production, or paid-large.
