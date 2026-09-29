# Adjudication — taking a review without folding or digging in

You receive the reviewer's findings and decide, alone, what happens to the plan. The two ways
this goes wrong are symmetrical: **sycophancy** (accepting everything because a second model
said it) and **stubbornness** (rejecting everything because you wrote it). One rule prevents
both.

## The name-the-flaw rule

> **Change your plan only for a flaw you can name. If you cannot name it, do not change it.
> Refuse a finding only for a flaw in the finding you can name. If you cannot name that
> either, you have not finished thinking.**

"Codex flagged it" is not a name. "Step 4 reads `config.tokens` before `init()` populates it,
so a cold start returns undefined" is a name. Both directions cost the same currency: a
specific, checkable statement about the world.

Where you can settle it by observation, do that instead of reasoning about it. Open the file.
Run the command. A five-second check outranks both models' opinions.

## Dispositions — every finding gets exactly one

| Disposition | Meaning | Required in the log |
|---|---|---|
| `accepted` | The flaw is real and the proposed fix is right | The flaw, restated in your own words |
| `accepted-with-variation` | The flaw is real, the fix is not the best one | The flaw + what you did instead + why |
| `rejected` | The finding is wrong | The specific error in it (misread code, assumed constraint, style preference) |
| `deferred` | Real, but outside the requested scope | Why it is out of scope + where it appears in the final report |
| `unconfirmed` | Cannot verify it against the code either way | What you tried; it does **not** get "fixed" speculatively |

Silently dropping a finding is the one thing that is never allowed. An unrecorded finding is
indistinguishable from a missed one.

## Common reviewer failure modes (reject these, with the reason)

- **Missing context.** Without `--repo`, the reviewer cannot see the file and infers a defect
  that does not exist. Reject with the actual code quoted.
- **Assumed constraint.** "This won't scale to 10k req/s" when nothing in the request implies
  that load. Reject; note the assumption.
- **Style preference dressed as a defect.** "Prefer a factory here." No failure named, no
  change.
- **Generic advice.** "Add error handling", "consider tests" with nothing specific. Reject as a
  non-finding; do not manufacture work to satisfy it.
- **Scope inflation.** A genuinely good idea the user did not ask for. `deferred`, into the
  recommendations section — never into the diff.

## Your own failure modes (accept these, even when it stings)

- The reviewer read the request more literally than you did — and was right.
- A decision you marked `high confidence` and `invented-by-agent` in the same row.
- A constant whose origin you cannot explain when asked.
- A step whose verification is "it should work".
- An abstraction you added because it felt clean, not because a second caller exists.

## When you fundamentally disagree

Legitimate, and it costs one more round rather than a shrug:

1. Revise everything else first, so round 2 is about the one contested decision.
2. Re-dispatch `plan-review --round 2` with the contested decision made sharper — state the
   constraint or evidence the reviewer appears to have missed, inside the plan itself.
3. If round 2 holds its position and you still disagree: implement the **safest** of the two
   readings (the one whose failure mode is cheapest to unwind), mark the decision `contested`,
   and quote both positions verbatim in the final report. The user adjudicates, once, with
   working code in front of them — which is a far better moment than a mid-run question.

Never run a third round. Two models that have each stated a named position twice will not
converge on a third pass; they will converge on whoever phrases things more confidently.

## Recording

Append to the decision log at the moment you decide, not afterwards:

```
## F3 (plan-review r1, §3 fatal flaws) — accepted-with-variation
Finding: "step 4 mutates the shared config map without a lock; concurrent init corrupts it"
Flaw, in my words: two callers of init() can interleave the map write; last writer wins silently.
Action: not a lock — made the config immutable and built it once at construction (D7 reverses D4).
```

The disposition, the restated flaw, and the action. Three lines. That trio is what makes the
final report auditable instead of a story about how carefully you thought.
