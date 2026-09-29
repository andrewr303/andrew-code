---
description: Decision audit — extract every choice the agent made (especially low-confidence ones) and grade each; audit choices, not the diff.
argument-hint: [branch or task, optional]
---

Run Phase 2 of the **ultimate-review** skill (decision extraction + grading) on $ARGUMENTS (or the work just completed).

1. If `.ultimate-review/decisions.md` exists, load it as primary evidence and verify entries against the actual work.
2. Ask verbatim: "While working on this, which choices did you make that you're not confident of? List all."
3. Walk every category in references/decision-taxonomy.md: interpretation, approach, fix-shape, dependencies, data/contracts, concurrency/memory, tests, success declarations.
4. For each decision: what/alternatives/confidence/origin (forced|inferred|invented)/blast radius/critical, and a per-decision verdict: sound / revisit / wrong.
5. Hunt coincidental fixes specifically: "what nearby input breaks this fix?" — any input-dimensioned fix is a hack until proven general.

Output the decision table plus the coincidental-fixes section from templates/review-report.md. Report only; no fixes in this pass.
