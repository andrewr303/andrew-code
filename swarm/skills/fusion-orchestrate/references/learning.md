# Learning — how Fusion compounds

Fusion gets better because every run is recorded and the next run reads that history. Two
feedback halves, both living in `~/.fusion/memory/` (the plugin ships a seed in its `memory/`) as plain, inspectable files:

- `runs.jsonl` — one JSON record per run (append-only).
- `lessons.md` — the distilled, human+model-readable digest you read at STEP 1.
- (`fusion.sh ledger` computes reliability scores and win-rates on demand from `runs.jsonl`.)

## Record every run (STEP 5)

```
fusion.sh ledger record '<json>'
```

Schema (omit fields you don't have; keep it one line of valid JSON):

```json
{
  "run_id": "<short id, e.g. timestamp-ish or task slug>",
  "task_type": "research|code|decision|verifiable|debug|quick|<your label>",
  "mode": "solo|panel|council|debate|vote|swarm",
  "judge": "codex",
  "winner": "<provider whose answer led the final, or 'synthesis' if no single one>",
  "consensus": 0.0,                // ratio over returning panelists [0..1], if meaningful
  "fallbacks": 0,                  // how many panelists were replaced/absent
  "panelists": [
    {"provider":"codex","model":"gpt-5.5","status":"returned","rank":1,"ms":48213},
    {"provider":"copilot","status":"returned","rank":2},
    {"provider":"opencode","status":"returned","rank":3},
    {"provider":"grok","status":"absent"}
  ],
  "outcome": "unknown"             // optional: shipped|accepted|rejected|unknown (user feedback later)
}
```

- **`status`**: `returned` (gave a usable answer) · `absent` (never ran / not installed) ·
  `timeout` · `fallback` (replaced by a Codex subagent) · `error`. Only `returned` counts
  as a success for reliability.
- **`rank`**: 1 = contributed most to the final answer. This is the qualitative signal — it
  teaches Fusion *who tends to win on which task type*, not just who's up.
- **`winner`**: the single biggest contributor, or `"synthesis"` when the answer was a true
  blend with no clear leader.

## How history feeds forward
- `fusion.sh ledger score <prov>` → Bayesian-smoothed reliability (prior 0.7, weight 5): a
  single hiccup doesn't condemn a provider, but a pattern does.
- `fusion.sh ledger rank` → reliability ranking **with a 5% fairness floor**, so a new or
  rarely-used panelist keeps getting sampled instead of being starved by early bad luck.
- `fusion.sh ledger leaderboard [task_type]` → who *wins* (not just who's reliable), overall
  or by task type.
- `fusion.sh ledger winners <task_type>` → which **mode** has worked best for this task type.

At STEP 1 you read `lessons.md` (regenerate it with `fusion.sh ledger lessons` after a few
runs or when you learn something durable). Use it to:
- **break ties in panel/route selection** — prefer the panelist that wins this task type;
- **set swarm routing** — send each subtask to its historical best performer;
- **drop dead weight** — if a provider is reliably last on a task type, you may leave it out
  (note it in the trail), but the fairness floor means you still resample occasionally.

## The discipline
- **No silent runs.** A run you don't record is lift you don't keep. Record even `solo`.
- **Rank honestly.** Inflated ranks poison the very signal that makes the next run smarter.
- **Lessons are advice, not law.** History informs your mode choice; the task in front of
  you decides it. Fusion stays dynamic — the ledger sharpens judgment, it doesn't replace it.
