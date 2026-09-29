# Implementation Review — the fast gate at the end

Phase 2 audited a plan; this audits what actually got built. It is deliberately **fast**: the
expensive thinking already happened before any code existed, so this pass exists to catch the
gap between the locked plan and reality — plus whatever the plan could not have anticipated.

## What the reviewer is asked for (fixed in `scripts/ureview.sh`)

1. **VERDICT** — `SHIP` / `TWEAK` / `FIX-FIRST` + one sentence.
2. **PLAN DRIFT** — divergences from the locked plan, each labelled improvement or silent scope
   change.
3. **DEFECTS** — concrete bugs, severity order, each with `file:line`, the failing condition,
   and a one-line fix.
4. **COINCIDENTAL FIXES** — works for the demonstrated case, not in general; with the nearby
   input that breaks it.
5. **EVIDENCE CHECK** — every success claim regraded against the exact vocabulary.
6. **TWEAKS** — small, safe, specific changes to apply now.
7. **NEEDS RE-ARCHITECTURE** — explicitly *not* tweaks; escalates to the human.

Sections 6 and 7 exist to keep the tweak pass honest. Without that split, a large finding gets
quietly implemented as if it were small, and the user never learns the design moved.

## What to send it

`implementation.md` should contain, in this order:

- **The locked plan's step list**, with each step marked done / changed / dropped.
- **What changed**: files touched and why, plus `git diff --stat` (and the diff itself when it
  is small enough to be read — a review that can see the lines beats a review of prose about
  them).
- **Every success claim with its evidence**: the command run, its actual output or exit status,
  and the grade you assigned.
- **Deviations from the plan**, each pointing at the decision-log entry that records it.
- **What you did NOT do**, and why (deferred findings, out-of-scope items, blocked checks).
- **Your Variant-B pride-gate answer**, verbatim — including the parts that sting.

Always pass `--repo "$PWD"`. The reviewer snapshots it and reads the real tree; findings then
cite real lines instead of guessing at them, and a review you cannot verify is a review you
cannot act on.

### …and always check `REPO_READ`

A mounted snapshot is not a read snapshot. `ureview.sh` prints `REPO_READ=ok|blocked|unverified|
n/a` after every dispatch, derived from the reviewer's own stream log. `blocked` means the
sandbox refused to launch a shell (verified on Windows + codex-cli, in both `read-only` and
`workspace-write`) — the reviewer saw only your summary.

When it is `blocked`:

- Include the actual code inline in `implementation.md` — the diff itself, not a description of
  it — and re-dispatch. A text-only review of a real diff is still worth having.
- Downgrade every finding that claims to cite a line the reviewer could not have opened.
- Say `repo access: blocked` in the report's loop table. The user needs to know the second pair
  of eyes read prose, not code.

Do not "fix" this by loosening the sandbox. A weaker sandbox for a review pass buys a little
context at the cost of letting an external CLI write outside its scratch — the wrong trade for a
gate whose entire job is to be conservative.

## The tweak-pass boundary

A **tweak** is: local, a few lines, no interface change, no new dependency, no behaviour change
beyond fixing the named defect, and re-verifiable with a check you already have.

Anything else is not a tweak:

| Reviewer says | You do |
|---|---|
| Tweak, and you can confirm it in the code | Apply it, re-run the check, record the new evidence |
| Defect you cannot reproduce or locate | Mark `unconfirmed`, report it, change nothing |
| Defect that is real but needs a design change, inside requested scope | Re-enter Phase 5 for that part; do not patch around it |
| Needs re-architecture, outside requested scope | Recommendation in the final report; the user decides |
| Style preference with no failure named | Reject with the reason; do not churn the diff |

**Re-verify after tweaking.** A tweak applied without re-running its check is `not run`, and the
evidence ledger must say so. The most common way a good review makes a branch worse is a
last-minute "obvious" fix that nobody ran.

## Stopping

One implementation review, one tweak pass. A second tweak pass is allowed only to repair a
failure the first pass introduced. There is no second implementation review — findings that
arrive after the tweak pass go to the user as recommendations, not into another loop. The mode
promises the user a finished result without round-trips, and an unbounded review cycle breaks
that promise as surely as asking them a question would.

## Degraded path

If the reviewer is absent, timed out, or errored: say so, run the same seven sections against
yourself as an explicit adversarial pass, label it `self-audit` everywhere it appears, and cap
the verdict at `SHIP-WITH-NOTES`. Do not write anything that reads as though a second model had
looked at the code.
