# Topologies — the six shapes and the six patterns

You do not invent a shape per task. You learn to recognize which of these a task already is.

## The vocabulary, precisely

A **node** is one bounded unit of work: one agent, one clearly scoped job, one input in, one
output out. Not "handle the customer conversation" — "classify this single ticket".

An **edge** is a dependency: this node's output feeds that node's input. Nothing more. Order
is not an edge. Proximity in your prompt is not an edge. The only thing that makes an edge
real is data actually crossing it.

Nodes are only safe to wire together when they carry a **contract**: bounded input, and a
defined output shape the next node can consume without parsing prose and hoping. In this
engine the contract is the node's `prompt` (what it must produce) plus its kind.

---

## 1. Fan-out

Several independent jobs — N sources to check, N files to review — run at once instead of
taking turns.

```
        ┌─ worker 1
plan ───┼─ worker 2
        └─ worker 3
```

Spec: one node with `for_each: [...]`, which expands to independent siblings (`w#0`, `w#1`…).
The design discipline is **resilience**: a failed unit resolves to absent and is reported;
it never sinks the batch. Filter the empties before the next stage.

## 2. Fan-in at a barrier

Something has to gather the fan-out. A **barrier** (`require: "all"`) is the point where
every upstream result must arrive before the next step starts — and it should be the
exception, not the default.

Reach for one only when the stage genuinely needs the whole set together:
- deduplicating across every source,
- ranking or scoring a full list,
- early exit because the total came back zero.

Not justified by: "I need to flatten first" (that is a `reduce` node inside the flow), "the
stages are conceptually separate", or "it is cleaner". The wait is real, measurable time.

**Why it matters.** Same three items, same per-stage durations: a barrier holds every item to
the pace of the slowest one; letting them stream lets the fastest item leave several time
units earlier. This engine schedules **dataflow, not waves** — a node fires the moment its
own deps resolve — so you get the streaming behavior by default and only pay for a barrier
where you asked for one.

## 3. The diamond

Fan-out plus fan-in — the shape serious systems converge to.

```
        ┌─ worker 1 ─┐
plan ───┼─ worker 2 ─┼─→ verify ─→ reduce ─→ result
        └─ worker 3 ─┘
```

Three parts worth naming separately:
1. **fan out** to gather breadth,
2. **reduce** with ordinary code to compress it (flatten, dedupe — deterministic and free,
   because no agent is involved),
3. **synthesize** with one final agent that needs the complete, compressed set.

The verification node is non-negotiable: a model grading its own work in its own context
misses most of its own mistakes.

## 4. Routing

Not every path is fixed. A `route` node inspects the input and decides which edge fires next
— classify a ticket, then send it to the right handler; check how large a diff is, then
choose a quick pass or a full audit.

The classification is the model's judgment; **the routing itself is code**, so the same input
takes the same path every time. If the reply names no valid target, no branch fires and both
are reported skipped — the engine never guesses a branch.

## 5. Verification

The real leverage of a graph is not more agents doing the work — it is the structure wrapped
around them that produces confidence in what they found.

A `verify` node sits on the edge *before* a result is allowed downstream, and its only job is
to try to **disprove** the finding. N independent skeptics, each given a **different lens**
(is it correct? is the evidence real? would it reproduce? does it hold adversarially? is it
still true?), each told to default to refuted when uncertain. Majority refutes → it never
reaches your report. Diverse skeptics catch what identical ones cannot.

## 6. Cycles that converge

Some jobs have no known size up front — an open-ended bug hunt where finding one issue
reveals three more. That calls for a controlled loop.

A cycle with no exit condition is an infinite loop that spends its whole budget rediscovering
the same ground. The version that works is **loop-until-dry**: keep going until K consecutive
rounds turn up nothing new, and dedupe **against everything ever seen** — not just against
what was confirmed. Dedupe against the confirmed set alone and every rejected result
reappears next round, forever.

Spec: the graph-level `repeat: {max_rounds, stop_after_dry_rounds}` block. Dependency cycles
between nodes are a lint **error**, not a loop — the engine names the cycle path and refuses.

---

## The six named patterns

| Pattern | Shape | Use for |
|---|---|---|
| **classify-and-act** | routing | tickets, diffs sized before review, tiered handling |
| **fan-out-and-synthesize** | diamond | audits, sweeps, multi-source research |
| **adversarial verification** | verify on the edge | any finding that will be reported as true |
| **loop until done** | converging cycle | open-ended discovery of unknown size |
| **generate-and-filter** | fan-out + rubric gate | produce 20 candidates, keep the 3 that survive |
| **tournament** | pairwise judging | naming, ranking, choices that are comparative not absolute |

Compose them freely. Six real shapes worth building:

1. **Security sweep** — one node per file hunting one class of issue, every finding verified
   before it reaches the report. *(fan-out-and-synthesize + adversarial verification)*
2. **Cited research report** — parallel searches, sources fetched, every claim checked
   against what the source actually says, then synthesized. *(same pair)*
3. **Port a module file by file** — one agent per fix in its own workspace, a second agent
   reviewing every change before it merges. *(+ isolation)*
4. **Adversarial review of a diff** — routed by size: a small change gets one quick pass, a
   large one triggers a full audit across several lenses. *(classify-and-act + verification)*
5. **Recurring scan of a fast-moving space** — many sources in parallel, ranked at a barrier,
   saved so it runs again next week. *(fan-out-and-synthesize, on a schedule)*
6. **Open-ended discovery** — finders in parallel, each result deduped against everything
   seen, looping until several rounds turn up nothing new. *(loop until done + verification)*

## Sources for the pattern set

The six-pattern taxonomy (classify-and-act, fan-out-and-synthesize, adversarial verification,
loop until done, generate-and-filter, tournament) follows Anthropic's published guidance for
Claude Code dynamic workflows. The stop rule's numbers come from Google DeepMind × MIT,
*Towards a Science of Scaling Agent Systems* (180 controlled configurations). Both are
reported here as their authors state them — if a decision turns on one of these figures,
check the primary source rather than this file.
