# Ultimate Review

**Post-coding workflow reviewer/reflector for Claude Code and Codex.**

> You don't need to audit the code. You NEED to audit the choices it made.

A coding agent is a perfect execution machine: give it a good decision and it lands the implementation. Leave anything underspecified and it can — and will — make bad choices, then declare success. Ultimate Review sits after the coding work and audits *decisions, not diffs*: it re-reads the original prompt, extracts every choice the agent made along the way, runs a pride gate, keeps a durable decision log, and cross-consults the other model family on critical decisions before anything merges.

## What it does

| Concept | What happens |
|---|---|
| **Intent reconciliation** | Original prompt vs. delivered work: dropped, reinterpreted, and unrequested items |
| **Decision audit** | "Which choices did you make that you're not confident of? List all." — then a full taxonomy walk, hunting coincidental fixes ("doubled a buffer and the test passed") and input-dimensioned hacks |
| **Pride gate** | "Are you proud of this branch? Would you stand behind it?" Agents have little ego; confessions triage straight into findings |
| **Decision log** | During work, low-confidence decisions are catalogued to `.ultimate-review/decisions.md` the moment they're made — the log tells the reviewer where to look when the run is done |
| **Cross-model consult** | Critical decisions (auth, money, migrations, concurrency, memory layout, public API, security) get pre-audited by the other family: GPT if Claude authored, Claude if GPT authored |
| **Verdict** | SHIP / FIX-FIRST / BLOCKED with a decision table and evidence ledger |

## Install

**Claude Code** (as a local plugin/marketplace):

```bash
/plugin marketplace add C:\Users\Andrew\plugins\ultimate-review
/plugin install ultimate-review@ultimate-review
```

**Codex**: the plugin ships a `.codex-plugin/plugin.json` manifest with `skills: ./skills/`; install/register it the same way as your other Codex plugins (e.g., point Codex at this directory or symlink `skills/ultimate-review` into your Codex skills location).

## Usage

Claude Code slash commands:

- `/ultimate-review` — full five-phase review of the work just completed
- `/pride-gate` — just the pride gate + hygiene sub-gate
- `/decision-audit` — just decision extraction and grading
- `/decision-log` — start the during-work decision log for the current task
- `/cross-consult <decision>` — second-model pre-audit of one critical decision

Codex / natural language (both agents): "Run ultimate review on this branch", "Which decisions did you make that you're not confident of? List all", "Are you proud of this branch?"

## Layout

```
.claude-plugin/         plugin.json + marketplace.json (Claude Code)
.codex-plugin/          plugin.json (Codex)
commands/               Claude Code slash commands
skills/ultimate-review/ SKILL.md (shared workflow, both agents)
  references/           decision-taxonomy, pride-gate, cross-model-consult
  templates/            decision-log, review-report
RELEASE_NOTES.md        version history
```

## The one rule

**NEVER merge agent-authored work without the "which decisions did you make?" audit.** Review the choices, not thousands of lines — and the codebase stays clean no matter how much AI implementation flows through it.

## License

MIT
