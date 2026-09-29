# Pride Gate — both variants

The cheapest high-yield review question there is. Agents have little ego: asked directly, they
report their own bad decisions accurately. In this mode the gate fires twice — once on the plan
(Phase 4, the expensive-to-unwind moment) and once implicitly on the implementation (Phase 5→6,
before handing it to the reviewer).

## Variant A — the plan gate (Phase 4, primary)

Ask yourself verbatim, and write the answer into the decision log before revising anything:

> "Am I proud of this plan? Would I stand behind every decision in it under review by a senior
> engineer who knows this codebase? If not, what specifically am I not proud of?"

Then the complementary sweep — pride surfaces what you *know* is weak, the confidence question
surfaces what you *suspect*:

> "Which choices in this plan am I not confident of? List all."

### Interpreting your own answer

| Answer shape | Meaning | Action |
|---|---|---|
| "Not proud of X" | Confirmed weak spot | Fix X now, before the plan locks |
| "Proud, except / although / but…" | **The hedge is the finding** | Triage the hedge like a reviewer finding |
| "Proud" + empty confidence list | Genuinely clean, or a blind spot | The plan audit carries the load; walk the taxonomy once more |
| Vague self-praise, no specifics | Non-answer | Re-ask category by category from `plan-audit.md` |

An unqualified "yes, proud" is not a pass by itself. It only means the reviewer's findings and
the taxonomy walk are the evidence, not your comfort.

### The plan-specific sweep

Before locking, confirm each of these has an answer that is not embarrassing:

- Every constant in the plan: where did the number come from?
- Every step: what observation would tell me this step is wrong?
- Every "then it will work": which command proves it, and can that command fail?
- Every abstraction: does a second caller exist, or am I building for an imagined one?
- Every dropped requirement from the original request: is it dropped on purpose, and is the
  user going to be told?
- The plan as a whole: if this is wrong, when do I find out — during the build, or in
  production? Late detection is a reason to add a check now.

## Variant B — the implementation gate (Phase 5 → 6)

Before dispatching the final review, ask:

> "Am I proud of this implementation and these changes? Would I stand behind them under review?
> If not, what specifically am I not proud of?"

Anything you confess here goes into `implementation.md` **before** the reviewer sees it. Hiding
a known weak spot from the reviewer wastes the review; disclosing it aims the review at the
place it is most likely to pay.

### Craft sub-gate (both variants)

Sound decisions can still ship sloppy work:

- Commits coherent; messages describe what actually changed.
- No debug prints, commented-out corpses, dead flags, leftover scaffolding.
- No TODO placeholders standing in for implementation.
- No `.skip` / `.only` / assertion-free tests.
- No secrets; no generated files churned without cause.
- No unrelated files touched.

Every hit here is something you should not be proud of. Add it to the list and fix it — these
are the cheapest findings in the run.

## Recording

Quote your own answer verbatim in the decision log and the final report. Do not paraphrase away
the sting: the exact wording of a confession is the triage signal, and a softened version of it
is a lost finding.
