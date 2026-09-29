# Release Notes — Ultimate Review

## v1.0.0 — 2026-07-18 (initial release)

First release of Ultimate Review, a post-coding workflow reviewer/reflector for **Claude Code** and **Codex**. It analyzes the initial command/prompt and the work a coding agent produced, and audits the *choices* the agent made rather than the raw diff.

### Highlights

- **Five-phase review workflow** (`skills/ultimate-review/SKILL.md`), shared by both agents:
  1. Intent reconciliation — original prompt vs. delivered work; dropped, reinterpreted, and unrequested items.
  2. Decision extraction — the core "While working on this, which choices did you make that you're not confident of? List all." question, followed by a full decision-taxonomy walk with explicit hunting for coincidental fixes (works-but-not-general, input-dimensioned hacks) and unverified success declarations.
  3. Pride gate — "Are you proud of this branch and these commits? Would you stand behind them?" Confessions and hedges triage directly into findings; includes a commit-hygiene sub-gate.
  4. Cross-model consult — critical decisions (auth, money, migrations, concurrency, memory layout, public API, security) are pre-audited by the other model family: GPT (via `codex exec`) for Claude-authored work, Claude (via `claude -p`) for GPT-authored work; disagreements are automatic FIX-FIRST items; unreachable consultants are marked `blocked`, never silently skipped.
  5. Verdict and report — SHIP / FIX-FIRST / BLOCKED with decision table, coincidental-fix list, consult record, intent gaps, and an evidence ledger using strict verification vocabulary.
- **During-work decision log protocol** — agents catalogue every not-fully-confident decision to `.ultimate-review/decisions.md` at the moment they make it (append-only, with alternatives, confidence, origin, blast radius) plus every declared success with its evidence, so the finished run tells the reviewer exactly where to look.
- **Claude Code slash commands**: `/ultimate-review`, `/pride-gate`, `/decision-audit`, `/decision-log`, `/cross-consult`.
- **Reference docs**: decision taxonomy (8 decision classes with grading rules), pride-gate protocol (verbatim questions + answer-interpretation table), cross-model consult protocol (direction table, consult prompt template, fallback rules).
- **Templates**: decision log and review report.
- **Dual manifests**: `.claude-plugin/` (plugin.json + marketplace.json) and `.codex-plugin/` (plugin.json with `skills: ./skills/`), matching the local plugin conventions.

### Known limitations / planned for future versions

- Cross-model consult relies on a second-model CLI or MCP tool being present; v1 falls back to an internal red-team pass when unreachable. A first-class consult transport (configurable command, model pinning) is planned.
- No hook-based automation yet: the decision log is started by command/instruction, not enforced by a PreToolUse/Stop hook. A hooks-based auto-logger and an auto pride gate on `git push`/PR creation are candidates for v1.1.
- Report is markdown-only; no machine-readable (JSON) findings output yet.
- No scoring/severity model beyond SHIP / FIX-FIRST / BLOCKED; per-decision risk scoring is under consideration.
- Single-skill design; splitting prospective (logging) and retrospective (review) into separate skills may improve auto-activation.
