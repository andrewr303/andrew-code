# Plan Audit — the reverse ultimate review

A classic Ultimate Review audits decisions after the branch exists. This audit runs the same
taxonomy against a plan, where reversing a decision costs a paragraph. Everything below is what
the reviewer is asked for (the contract is fixed in `scripts/ureview.sh`) and what you, the
author, should therefore have made auditable in the plan.

## Why the plan is the right artifact

A diff shows what was done; only a plan shows *what was chosen and what was rejected*. The
canonical agent failure — tracing a bug perfectly, landing a fix that works by coincidence,
declaring success — is invisible in a diff review of thousands of lines and obvious in a plan
that says "double the buffer to 256". Audit the choice while it is still one sentence.

## The eight sections (what the reviewer must return)

1. **VERDICT** — `SOUND` / `REVISE` / `REJECT` + one sentence.
2. **DECISION AUDIT** — a row per material decision: confidence, origin, blast radius, verdict.
3. **FATAL FLAWS** — decisions that will not survive contact with the codebase, each with the
   triggering condition and the smallest correct alternative.
4. **INPUT-DIMENSIONED HACKS** — steps sized to the current example rather than a mechanism.
5. **MISSING FROM THE PLAN** — dropped, reinterpreted, or silently scoped-out requirements, and
   unrequested additions.
6. **VERIFICATION GAPS** — asserted-to-work steps with no check that could fail, each paired
   with the command or test that would falsify it.
7. **WHAT I WOULD DO DIFFERENTLY** — flaw named first, alternative second.
8. **RISK RANKING** — the three riskiest steps in execution order.

A reviewer that returns praise, a summary of the plan, or "consider adding tests" has not
reviewed it. Treat a finding with no named flaw as no finding.

## Decision taxonomy — walk this while writing the plan

Every category below is a place a plan can silently choose. "No decisions of this kind" is
itself a claim to verify.

### 1. Interpretation
Ambiguous wording resolved one way without surfacing it; assumed defaults (platform, version,
framework idiom, file location); inferred scope boundaries.
**Grade harshly when** the request supports two materially different readings and the plan
picks one silently.

### 2. Approach and architecture
Algorithm and data-structure choice; new abstraction vs. extending an existing one; sync vs.
async; batch vs. streaming; where state lives and who owns it.
**Grade harshly when** no alternative was ever considered — first idea planned is first idea
shipped.

### 3. Fix shape (the most dangerous class)
Root-cause fix vs. symptom suppression; general mechanism vs. input-dimensioned hack. Litmus:
- "What nearby input breaks this?" (saturating at 256 instead of 128; +8 instead of +4)
- "Is the fix's size or shape derived from THIS example?" If yes, it is a hack.
- "Would the correct general mechanism look structurally different?"

Any yes ⇒ `revisit` minimum, usually `wrong`.

### 4. Dependencies and tooling
New packages, version pins, lockfile changes, build steps, codegen, config flags.
**Grade harshly when** a dependency is added for something the stdlib or an existing dependency
already does.

### 5. Data and contracts
Schema, type, and API shape; nullable vs. required; error contract; serialization, encoding,
units, timezones, precision; backward-compatibility posture.

### 6. Concurrency, memory, performance
Locking granularity, ordering assumptions, buffer sizes, pool layout. Anything sized by a
constant: **where did the constant come from?**

### 7. Tests
What gets a test and what does not, and why. Can each proposed test actually fail? A plan that
promises a test which cannot fail has promised nothing.

### 8. Success declaration
Every "this will work" in the plan: what observation is supposed to back it, and is that
observation actually planned?

## Grading fields (use these exact values)

| Field | Values |
|---|---|
| Confidence | high / medium / low |
| Origin | forced-by-request / inferred-from-codebase / invented-by-agent |
| Blast radius | local / module / system / data-loss-or-security |
| Criticality | normal / **critical** (auth, money, migration, concurrency, memory layout, public API, security boundary) |
| Verdict | sound / revisit / wrong |

**critical + (low confidence OR invented)** is the combination that most deserves a second
round. If the round-1 audit leaves such a decision unresolved, spend round 2 on it specifically
rather than on the whole plan again.

## What the author owes the reviewer

The audit is only as good as its input. Before dispatching:

- Paste the load-bearing code excerpts (or pass `--repo` so the reviewer can read the tree).
- State constraints the reviewer cannot infer: platform, versions, performance budget,
  compatibility promises, deadlines.
- List alternatives honestly, including the ones you dismissed quickly.
- Do **not** pad the plan to look thorough. A padded plan produces a padded review.
