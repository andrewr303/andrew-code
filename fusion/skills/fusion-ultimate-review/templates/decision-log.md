# Decision Log — `$RUN_DIR/decisions.md`

`ureview.sh init` creates this file with a header. You append to it throughout the run, **at the
moment each decision is made**. Retrospective memory of "what did I decide?" is lossy; the log
is not, and it is the primary input to the final report.

```markdown
# Decision Log — <RUN_ID>

Task: <one-line restatement>
Author: claude (in-context host)   Reviewer: <codex|…>
Started: <timestamp>

---

## D1: <short decision title>
- Phase: plan | implementation | tweak
- When: <timestamp or step>
- Decision: <what was chosen>
- Alternatives: <what else was considered; "none" is valid and damning>
- Why: <reasoning at the time — not cleaned up later>
- Confidence: high | medium | low
- Origin: forced-by-request | inferred-from-codebase | invented-by-agent
- Blast radius if wrong: local | module | system | data-loss-or-security
- Critical: yes | no
- Audit disposition: <filled in after the plan review: sound | revisit | wrong | not-flagged>

## D7: reverses D4 — <title>
- Why reversed: <the observed fact that contradicted D4 — reality, not a change of mind>
- ...

---

## Reviewer findings

## F1 (plan-review r1, §3 fatal flaws) — accepted
Finding: "<quoted, condensed>"
Flaw, in my words: <restatement that proves you understood it>
Action: <what changed, referencing the D-entry>

## F2 (plan-review r1, §7) — rejected
Finding: "<quoted>"
Why it is wrong: <the specific error — misread code, assumed constraint, style preference>

## F5 (impl-review, §3 defects) — unconfirmed
Finding: "<quoted>"
What I tried: <the check that failed to reproduce it>
Action: none. Reported to the user as unconfirmed.

---

## Pride gate

Plan gate (Phase 4), verbatim:
> "<your own answer, including the hedges>"
Items extracted: <list, or "none">

Implementation gate (Phase 5), verbatim:
> "<your own answer>"
Items extracted: <list, or "none">

---

## Success claims

| Claim | Command / observation | Actual result | Grade |
|---|---|---|---|
| "race is fixed" | `npm test -- auth/refresh.race.test.ts` | 4 passed | focused test passed |

Grades, used exactly: `verified end-to-end` · `focused test passed` · `static checks passed` ·
`render verified` · `not run` · `blocked` · `assumption`.
```

## Rules

- **Append-only.** A correction is a new numbered entry that references the old one
  (`D7: reverses D4 because …`), never an edit. The trail of what you believed and when is the
  audit; editing it destroys the thing being audited.
- Log every decision you are not completely confident in, **plus** every decision in a critical
  category even at high confidence.
- Log every reviewer finding with exactly one disposition. A finding with no disposition is
  indistinguishable from one you missed.
- Log every success claim with its evidence at the moment you declare it — not at report time,
  when the grade drifts upward.
- Never store secrets, tokens, or raw sensitive data here.
