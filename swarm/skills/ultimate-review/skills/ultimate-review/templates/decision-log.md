# Decision Log — .ultimate-review/decisions.md

Copy this template to `.ultimate-review/decisions.md` at the start of a nontrivial task. Append entries AT THE MOMENT decisions are made — retrospective memory is lossy; the log is not. When the run is done, this file tells the reviewer exactly where to look.

```markdown
# Decision Log

Task: <one-line restatement of the original prompt>
Agent: <claude|gpt|other> <model/version if known>
Branch: <branch name>
Started: <timestamp>

---

## D1: <short decision title>
- When: <timestamp or commit>
- Decision: <what was chosen>
- Alternatives: <what else was considered; "none" is a valid, damning answer>
- Why: <reasoning at the time>
- Confidence: high | medium | low
- Origin: forced-by-prompt | inferred-from-codebase | invented
- Blast radius if wrong: local | module | system | data-loss-or-security
- Critical: yes | no
- Consult: n/a | pending | <verbatim second opinion + agree/disagree>

## D2: ...

---

## Success claims

| Claim | Evidence | Grade |
|---|---|---|
| "<what was declared done>" | <command/observation> | verified end-to-end / focused test passed / static checks passed / not run / assumption |
```

## Rules

- One entry per decision, numbered, append-only. Corrections get a new entry referencing the old ("D7: reverses D3 because…"), never an edit.
- Log EVERY decision you are not completely confident in, plus all decisions in the critical categories even at high confidence.
- Log every declared success with its evidence at declaration time.
- Whether the file is committed or gitignored is a per-project choice; default to committed on feature branches (it is review input), stripped before merge if the project prefers.
