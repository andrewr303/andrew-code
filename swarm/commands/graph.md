---
description: Graph engineering — design the structure the work runs through, not the prompt. Task graphs (typed nodes, dataflow scheduling, adversarial verification, deterministic reducers, routers, bounded loops, human gates) and knowledge graphs (ontology → extraction → fusion → GraphRAG memory with typed edges, provenance, and bitemporal facts).
argument-hint: <task or question> [--spec graph.json] [--plan] | kg <op>
---

Invoke the **fusion-graph** skill on:

$ARGUMENTS

**Route first — the skill's STEP 0.** Is this about how the work *runs* (task graph: audits,
sweeps, migrations, multi-source research, review pipelines, open-ended discovery) or about
what the system *remembers* (knowledge graph: build a KG from docs, agent memory, GraphRAG,
entity resolution, "who decided X and what broke because of it")? Then apply the value test —
a graph must earn its coordination cost, and saying "this does not need a graph, here is the
answer" is a valid outcome.

**Plan before you spend. Always.** The lint+schedule pass is free and catches the defects
that cost real money:

```
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh graph "<task>" --spec graph.json --plan
```

It reports the node count, the **critical path** (how many sequential stages the run actually
costs — not the node count), the widest parallel stage, which nodes cost zero calls, the
estimated call total, and every lint finding: fake edges (a node that depends on an input it
never reads), redundant edges, unneeded barriers, dependency cycles, two writers on one file,
routers with one target, loops with no dry condition, and any budget a run would blow. Lint
**errors block dispatch entirely** — a malformed topology should cost nothing.

Then run it:

```
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh graph "<task>" --spec graph.json --json
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh graph "<task>" --nodes "scan=opencode,check=grok:verify,merge=:reduce" --edges "scan>check,check>merge" --json
```

Node kinds: `work` (one job, one panelist) · `verify` (N skeptics on different lenses, each
told to **refute**; majority kills the finding) · `route` (classify, then fire exactly one
edge — the choice is code, so the same input takes the same path) · `reduce` (deterministic
concat/dedupe/count — **zero calls**, because an agent is the most expensive way to flatten a
list) · `gate` (a real verification command whose result outranks any vote) · `human` (halts
on irreversible edges; resume with `--approve <ids>` only after the user says yes).

Scheduling is **dataflow, not waves**: a node fires the moment its own deps resolve, so a
fast branch is never held to the pace of an unrelated slow one. Barriers are opt-in
(`require: "all"`). A failed node resolves to **absent**, its absence is stated verbatim to
every downstream node, and it never sinks the batch.

For the memory half:

```
bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh kg --op init|ingest|lint|candidates|fuse|query|path|serialize --graph-name <n>
```

Typed edges with domain/range validated in code, provenance on every fact, bitemporal
validity (`--as-of`), blocking → layered matching → reversible deterministic merge, and a
linter for the graph itself. Ingest **fails closed**: an undeclared entity type or a
domain/range violation is rejected and reported, never coerced — read the `rejected` list, it
is your extraction quality signal.

Show the cost banner (numbers from `--plan`, never estimated by hand) before dispatching.
Read the real transcript, judge it yourself, never present an absent node as agreement, and
record the run (`task_type: swarm:graph`).
