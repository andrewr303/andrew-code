# Final Report — `$RUN_DIR/report.md`

Written in Phase 8. Order is answer → reasoning → risk: the user asked for work, not for a
process transcript, so the work leads and the audit trail follows.

```markdown
# <what was built> — Fusion Ultimate Review

## 1. What was built
<Two to five sentences, plain, in your own voice. What the user now has, and how to use or see
it. No process talk here.>

## 2. Verdict
SHIP | SHIP-WITH-NOTES | FIX-FIRST | BLOCKED — <one sentence why>

## 3. The loop that ran
| Gate | Reviewer | Status | Outcome |
|---|---|---|---|
| plan-review r1 | codex | returned (42s), repo access: none | REVISE — 3 fatal, 2 gaps |
| plan-review r2 | codex | returned (31s), repo access: none | SOUND |
| pride gate (plan) | self | — | 2 hedges fixed |
| impl-review | codex | returned (55s), repo access: ok | TWEAK — 4 tweaks, 0 defects |
| tweak pass | self | — | 4 applied, all re-verified |

<If any row is absent/timeout/error, say so here and say the run was degraded. If a row's repo
access was `blocked`, say that too — a text-only review is not a code review, and the user is
entitled to know which one they got.>

## 4. Decisions
| # | Decision | Confidence | Origin | Blast radius | Audit verdict | Final |
|---|---|---|---|---|---|---|
| D1 | … | medium | invented | module | revisit | revised → D7 |

## 5. Findings ledger
| # | Source | Finding (condensed) | Disposition | Reason |
|---|---|---|---|---|
| F1 | plan r1 §3 | … | accepted | … |
| F2 | plan r1 §7 | … | rejected | misread `client.ts:88` — the map is rebuilt, not mutated |
| F5 | impl §3 | … | unconfirmed | could not reproduce; `<check run>` |

Contested (quoted verbatim, for the user to adjudicate):
> Reviewer: "<position>"
> Me: "<position>"
> I implemented: <the safer reading> because <cheapest failure to unwind>.

## 6. Evidence ledger
| Success claim | Command / observation | Grade |
|---|---|---|
| "the race is fixed" | `npm test -- auth/refresh.race.test.ts` → 4 passed | focused test passed |
| "works on mobile" | — | not run |

Grades used exactly: `verified end-to-end` · `focused test passed` · `static checks passed` ·
`render verified` · `not run` · `blocked` · `assumption`.

## 7. Deferred and recommended
- <out-of-scope items the review surfaced, each one line, for the user to accept or drop>

## 8. Residual risk
<The one or two things most likely to be wrong, and what observation would reveal it. If a
decision is contested, name it here too.>
```

## Rules

- Lead with the deliverable. A user who wants only the first section should be able to stop
  reading there and be fully served.
- The loop table must reflect real dispatches. An absent reviewer is stated, never smoothed
  over — and a run with an absent reviewer cannot be reported as cross-reviewed.
- Every reviewer finding appears in the ledger with a disposition. Nothing is dropped silently.
- Grades are the exact vocabulary. If you did not run it, it is `not run` — no exceptions, no
  softer synonyms.
- Do not narrate the phases. The tables *are* the audit trail; prose about how carefully you
  worked is not evidence.
