# Decision Taxonomy — what counts as a "decision" and how to grade it

Every item below is a place where an agent can silently choose. Walk the full list in Phase 2; "no decisions of this kind were made" is itself a claim to verify.

## 1. Interpretation decisions
- Ambiguous wording in the prompt resolved one way without surfacing it.
- Assumed defaults: platform, language version, framework idioms, file locations.
- Inferred scope: what the agent decided was "in" vs "out" of the task.

**Grade harshly when**: the prompt supports two materially different readings and the agent picked one silently.

## 2. Approach/architecture decisions
- Algorithm or data-structure choice.
- New abstraction vs. extending an existing one.
- Sync vs. async, batch vs. streaming, push vs. pull.
- Where state lives; who owns it.

**Grade harshly when**: no alternative was ever considered ("first idea shipped").

## 3. Fix-shape decisions (the most dangerous class)
- Root-cause fix vs. symptom suppression.
- General mechanism vs. input-dimensioned hack.

Canonical failure: the agent traces a real bug with perfection, lands a fix that DOES make the failing case pass — by doubling a buffer, adding a second ring, padding a size — and declares success. The program works; the underlying issue is dormant. Litmus tests:

- "What nearby input breaks this fix?" (a workload saturating at 256 instead of 128, an +8 jump instead of +4…)
- "Is the fix's size/shape derived from THIS test case?" If yes, it's a hack.
- "Would the correct general mechanism look structurally different?" (the cube of task-stacks, not the two-ring compensation).

**Any yes ⇒ decision verdict `revisit` minimum, usually `wrong`.**

## 4. Dependency and tooling decisions
- New packages, version pins, lockfile changes.
- New build steps, codegen, config flags.

**Grade harshly when**: a dependency was added for something the stdlib/existing deps already do.

## 5. Data and contract decisions
- Schema/type/API shape changes; nullable vs. required; error contract.
- Serialization formats, encodings, units, timezones, precision.
- Backward compatibility posture.

## 6. Concurrency, memory, and performance decisions
- Locking granularity, ordering assumptions, buffer sizes, pool layouts.
- Anything sized by a constant: WHERE did the constant come from?

## 7. Test decisions
- What got a test, what didn't, and why.
- Can each test actually fail? (Assertion-free or tautological tests are decisions too.)
- Skipped/`.only` tests, reduced fixtures, mocked-away seams.

## 8. Success-declaration decisions
- Every "done", "fixed", "works" claim: what observation backs it?
- Was the ORIGINAL failing case re-run, or only a proxy?

## Confidence & criticality grading

For each decision, record:

| Field | Values |
|---|---|
| Confidence (agent's own) | high / medium / low |
| Origin | forced by prompt / inferred from codebase / invented by agent |
| Blast radius if wrong | local / module / system / data-loss-or-security |
| Criticality | normal / **critical** (auth, money, migration, concurrency, memory layout, public API, security) |

**Critical + (low confidence OR invented)** ⇒ mandatory cross-model consult (Phase 4).
