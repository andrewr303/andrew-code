# Ultimate Review Report — output template

```markdown
# Ultimate Review — <branch/task>

## 1. Verdict
SHIP | FIX-FIRST | BLOCKED — <one sentence why>

## 2. Pride gate
> "<agent's answer, verbatim>"
Triage: <items extracted from the confession/hedges, or "no confessions">

## 3. Decision table
| # | Decision | Confidence | Origin | Blast radius | Verdict |
|---|---|---|---|---|---|
| D1 | ... | low | invented | system | revisit |

## 4. Coincidental fixes ("works but not general")
- <fix> — passes because <coincidence>; general alternative: <mechanism>. (or "none found")

## 5. Cross-model consults
| Decision | Consultant | Second opinion (verbatim, condensed) | Agreement |
|---|---|---|---|
| D3 | codex/claude | "..." | agree / DISAGREE |
(or "no critical decisions" / "blocked: no second model reachable — red-team pass run instead")

## 6. Intent gaps
- Dropped: <requirements silently dropped>
- Reinterpreted: <prompt said X, work did Y>
- Unrequested: <additions the prompt never asked for>

## 7. Evidence ledger
| Success claim | Evidence | Grade |
|---|---|---|
| "fix works" | re-ran original failing case | verified end-to-end |

## 8. Next actions (smallest first)
1. ...
```

Grades vocabulary (use exactly): `verified end-to-end`, `focused test passed`, `static checks passed`, `render verified`, `not run`, `blocked`, `assumption`.
