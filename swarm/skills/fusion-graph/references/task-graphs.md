# Task graphs — building and running one

*(The execution half: how agents work, as opposed to what they remember.)*

## The stop rule — read this before you build anything

From Google DeepMind × MIT, *Towards a Science of Scaling Agent Systems* (180 controlled
configurations): coordinated teams beat a single agent by ~80% on work that splits into
independent pieces — and **every** multi-agent configuration lost on sequential work where
each step needs the full picture (degrading 39–70%). Uncoordinated agents amplified each
other's errors 17.2×; a single coordinator owning the merge cut that to 4.4×.

The decision procedure:
1. Ask: *where does my work split into pieces that never read each other's results?*
2. Split only that. Everything sequential stays with one agent.
3. Never let findings merge without one owner of the merge — and that owner is you.

More agents is not a strategy. The shape of the work decides. (These figures are the study's
as reported; treat them as the reason for the procedure, not as measurements of your task.)

## Node kinds

| kind | spends a call | what it does |
|---|---|---|
| `work` | 1 | one bounded job on one panelist |
| `verify` | `voters` | N skeptics try to **refute** the input; majority refutes → killed |
| `route` | 1 | classifies, then fires **exactly one** of `targets` |
| `reduce` | **0** | deterministic aggregation: `concat` · `dedupe` · `list` · `count` |
| `gate` | **0** | runs a real verification command; its result outranks any vote |
| `human` | **0** | halts for approval; downstream is skipped until `--approve` |

## Spec format

```json
{
  "name": "security-sweep",
  "budget": {"max_nodes": 64, "max_calls": 200, "max_rounds": 4, "node_timeout": 600},
  "repeat": {"max_rounds": 1, "stop_after_dry_rounds": 2},
  "nodes": [
    {"id": "scan", "kind": "work", "provider": "opencode", "model": "", "effort": "",
     "for_each": ["src/auth.ts", "src/pay.ts", "src/api.ts"],
     "prompt": "Audit {{item}} for authz bypass. TASK: {{task}}\nReturn one finding per line.",
     "writes": []},

    {"id": "verify", "kind": "verify", "provider": "grok", "voters": 3,
     "deps": ["scan#0", "scan#1", "scan#2"], "prompt": "{{inputs}}"},

    {"id": "merge", "kind": "reduce", "op": "dedupe", "deps": ["verify"]},

    {"id": "report", "kind": "work", "provider": "copilot", "deps": ["merge"],
     "require": "all", "prompt": "Write the report from the surviving findings:\n{{merge}}"},

    {"id": "gate", "kind": "gate", "cmd": "npm test --silent", "cwd": ".", "deps": ["report"]},
    {"id": "ship", "kind": "human", "deps": ["gate"], "reason": "opens a PR against main"}
  ]
}
```

Fields: `id` · `kind` · `provider` · `model` · `effort` · `deps` · `require` (`any` default,
`all` = barrier) · `prompt` · `for_each` · `writes` · `targets` (route) · `voters` /
`threshold` (verify) · `op` (reduce) · `cmd` / `cwd` (gate) · `reason` (human) · `label`.

Prompt placeholders: `{{task}}` · `{{inputs}}` (all upstream outputs, with absences stated) ·
`{{<dep_id>}}` (one specific upstream) · `{{item}}` (this fan-out sibling) · `{{round}}` ·
`{{seen}}` (everything the loop has already surfaced).

## Running it

```bash
swarm.sh graph "<task>" --spec graph.json --plan            # lint + schedule + cost, no spend
swarm.sh graph "<task>" --spec graph.json --json            # run
swarm.sh graph "<task>" --spec graph.json --approve ship    # resume past a human gate
swarm.sh graph "<task>" --nodes "a=codex,v=grok:verify" --edges "a>v"   # compact DSL
```

`--plan` is free and is not optional in practice. It returns:

- the node count, and the widest parallel stage;
- the **critical path** — how many sequential stages the run actually costs. This is the
  number that matters, not the node count: 40 nodes three stages deep is a cheap graph, and
  6 nodes six stages deep is an expensive one;
- which nodes cost nothing (`reduce`, `gate`, `human`);
- the estimated call total. If it exceeds `max_calls` the run refuses **before** spending
  anything.

## What the lint catches

| code | level | meaning |
|---|---|---|
| `fake_edge` | warn | a node depends on an input it never references — delete the edge and they run in parallel |
| `redundant_edge` | warn | already implied transitively |
| `barrier` | warn | `require: all` over many inputs — confirm the stage needs the complete set |
| `route_one_target` | warn | a router with one target is not a decision |
| `loop_no_exit` | warn | `repeat` with no dry condition |
| `cycle` | **error** | dependency cycle, with the path named |
| `two_writers` | **error** | two nodes write the same file |
| `dangling_dep` / `bad_target` | **error** | edge to a node that does not exist |
| `no_provider` | **error** | a dispatching node with no panelist |
| `bad_threshold` | **error** | verify verdict could never fire |
| `node_cap` / `call_cap` / `round_cap` | **error** | a budget would be exceeded |

Errors block dispatch entirely. That is deliberate: a malformed topology should cost nothing.

## Guardrails (the four caps that keep a graph from becoming an expensive accident)

1. **Every loop gets a maximum number of rounds** — `budget.max_rounds` caps `repeat`.
2. **One writer per file** — declare `writes` and the lint enforces it. When agents genuinely
   must edit a shared tree in parallel, give each its own workspace and merge afterward
   (Fusion's proposal mode); that is a seatbelt for one topology, not a tax on every graph.
3. **The routing lives in written steps** — the model fills the jobs, not the plan.
4. **A hard cap on how many agents can spawn** — `budget.max_nodes`, `budget.max_calls`.

## Failure isolation

A node that fails, times out, or returns nothing resolves to **absent**. Its absence is
written into every downstream prompt in full ("ABSENT … Do not treat this as agreement or as
evidence"), and it appears in the run's `absent` list. Downstream nodes still run with what
arrived (`require: "any"`, the default); a barrier node (`require: "all"`) is reported
**skipped** rather than silently proceeding on partial input.

## The human gate

The human is a node. Route every irreversible edge — send, publish, refund, delete, deploy —
through explicit approval. Placement rule: **put the gate where a mistake is expensive to
undo, not on every step.** A gate on everything makes the human the bottleneck; a gate on
nothing means nobody is watching.

When a run returns `needs_approval`, stop and ask the user in plain language what is about to
happen and what is hard to undo. Re-run with `--approve <ids>` only after they say yes. Judge
the system on numbers that cannot argue back (tests that ran, gates that passed), never on
its own self-reports.

## Worked shapes

**Routed review** — small diffs get one pass, large ones a full audit:
```json
{"nodes": [
  {"id": "size", "kind": "route", "provider": "codex", "targets": ["quick", "audit"],
   "prompt": "Diff:\n{{task}}\nSmall/mechanical -> quick. Large or risky -> audit."},
  {"id": "quick", "kind": "work", "provider": "copilot", "deps": ["size"], "prompt": "Review: {{task}}"},
  {"id": "audit", "kind": "work", "provider": "grok", "deps": ["size"],
   "for_each": ["correctness", "security", "performance"],
   "prompt": "Review {{task}} through the {{item}} lens only."},
  {"id": "out", "kind": "reduce", "op": "concat", "deps": ["quick", "audit#0", "audit#1", "audit#2"]}
]}
```

**Open-ended discovery** — finders in parallel, loop until dry:
```json
{"repeat": {"max_rounds": 4, "stop_after_dry_rounds": 2},
 "nodes": [
  {"id": "find", "kind": "work", "provider": "opencode",
   "for_each": ["by container", "by data flow", "by error path"],
   "prompt": "Hunt bugs {{item}} in: {{task}}\nAlready found (do not repeat):\n{{seen}}\nOne per line."},
  {"id": "check", "kind": "verify", "provider": "grok", "voters": 3,
   "deps": ["find#0", "find#1", "find#2"], "prompt": "{{inputs}}"},
  {"id": "keep", "kind": "reduce", "op": "dedupe", "deps": ["check"]}
]}
```
