# Plan — `$RUN_DIR/plan.md`

The plan is the artifact that gets audited, so it must **expose** decisions rather than narrate
around them. Write it in this shape; the reviewer's contract maps onto these sections.

```markdown
# Plan — <one-line restatement of the request>

Run: <RUN_ID>          Author: claude          Reviewer: <codex|…>

## 1. Goal and acceptance predicate
Goal: <what the user actually wants, in one sentence — the decision it supports, not just the words>
Done when: <the observable condition that will mean this is done AND right. A command, an
observed behaviour, a state. Not "the code is written".>
Out of scope (deliberately): <what this plan will not touch>

## 2. Grounding — what I actually observed
| Fact | Where | Why it matters |
|---|---|---|
| `refreshToken()` mutates the shared client | src/auth/client.ts:88-104 | step 3 depends on it being idempotent |

Load-bearing excerpts (paste them; the reviewer may have no repo access):

```<lang>
<only the lines the plan depends on>
```

Unknowns I could not resolve: <list, or "none">

## 3. Decisions
### D1 — <short title>
- **Chosen:** <what>
- **Alternatives considered:** <list; "none" is legal and damning — write it if true>
- **Why:** <the reasoning, in terms of the observed facts above>
- **Confidence:** high | medium | low
- **Origin:** forced-by-request | inferred-from-codebase | invented-by-agent
- **Blast radius if wrong:** local | module | system | data-loss-or-security
- **Critical:** yes | no   <!-- auth, money, migration, concurrency, memory layout, public API, security -->
- **If this is wrong, I find out:** <when — during the build, at test time, or in production>

### D2 — …

## 4. Steps
| # | Step | Files | Observable result | Depends on |
|---|---|---|---|---|
| 1 | … | … | … | — |

## 5. Verification plan
| Claim | Command / observation | What failure looks like |
|---|---|---|
| "refresh no longer races" | `npm test -- auth/refresh.race.test.ts` | test times out or asserts two tokens |

Every claim needs a check that **could fail**. A row whose failure column reads "n/a" is a gap;
fix it here, not after the audit points at it.

## 6. Risks
| Risk | Likelihood | If it happens | Mitigation in this plan |
|---|---|---|---|

## 7. Not doing
- <things a reasonable reader might expect, that this plan deliberately skips, and why>
```

## Rules

- Numbered decisions, numbered steps. The reviewer cites them by number and so will you.
- Confidence is your honest read, not a sales pitch. `low` + `invented-by-agent` is the row the
  audit exists to find; hiding it wastes the round.
- Do not pad. A plan inflated to look thorough produces a review inflated to match, and the
  signal disappears in both.
- Copy each decision into `$RUN_DIR/decisions.md` as you write it — the log is append-only and
  the plan will be revised.
