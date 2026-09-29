---
description: Run the full Ultimate Review post-coding reflection on the work just completed (decision audit, pride gate, cross-model consult, verdict).
argument-hint: [branch or task description, optional]
---

Run the **ultimate-review** skill end-to-end on the most recently completed coding work ($ARGUMENTS if specified, otherwise the current branch / this session's work).

Follow the skill exactly:
1. Gather inputs: the original prompt (quote it), the work done (`git log`/`git diff --stat` vs base), and `.ultimate-review/decisions.md` if present.
2. Phase 1 — Intent reconciliation.
3. Phase 2 — Decision extraction: "While working on this, which choices did you make that you're not confident of? List all." Then walk the full decision taxonomy.
4. Phase 3 — Pride gate, answer quoted verbatim.
5. Phase 4 — Cross-model consult on critical decisions (consult GPT via `codex exec` since this work was authored by Claude; if unreachable, mark blocked and red-team instead).
6. Phase 5 — Report using templates/review-report.md, verdict SHIP / FIX-FIRST / BLOCKED.

Report only. Do not fix anything in this pass.
