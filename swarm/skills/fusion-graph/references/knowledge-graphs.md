# Knowledge graphs — the 9-stage pipeline

*(What agents remember. Distilled from Southeast University's graduate Knowledge Graph course,
[npubird/KnowledgeGraphCourse](https://github.com/npubird/KnowledgeGraphCourse), Prof. Peng
Wang — an independent English distillation adapted for LLM-era agents; no lecture material is
redistributed here.)*

Core mental model: a knowledge graph is a **product with a schema**, not a pile of triples.
Quality comes from the pipeline order — model the domain BEFORE extracting, fuse BEFORE
storing, evaluate at every stage.

Run the stages in order. Small projects collapse 4–6 into one extraction pass, but **never
skip stage 3 (ontology) or stage 8 (fusion)** — that is where real-world graphs fail.

---

## 1 · Scope & value test

Confirm a graph beats a simpler structure. A graph pays off when queries are multi-hop ("who
worked with X on projects using Y", "who decided X and what broke because of it"), when
entities recur across documents, or when relationships **are** the data. If lookups are
single-hop, use a table and stop. If a question needs aggregation rather than traversal, that
is a database, not a graph.

Write **10–20 competency questions** the graph must answer. They are the ontology's spec and
its test suite.

## 2 · Knowledge representation choice

| Representation | Choose when | Cost |
|---|---|---|
| **Property graph** (this engine, Neo4j, Kùzu) | default for products and agent memory | no formal semantics; consistency is your job |
| **RDF/OWL** | interop with existing ontologies, description-logic reasoning | verbose; reification for edge properties |
| **Typed edges in JSON/SQLite** | <50K nodes, single application, agent-local memory | query power capped |

Decide **now**, not later, how every fact carries **time** (validity interval or event
timestamp) and **provenance** (source + extraction timestamp + confidence). Retrofitting
provenance after fusion is effectively impossible. `kgraph.py` carries both on every edge.

## 3 · Ontology modeling (never skip)

1. Enumerate **5–15 entity types** from the competency questions. Each gets a one-line
   definition and 2–3 real examples.
2. Enumerate **10–30 relation types** with **domain and range** (`EMPLOYED_BY: Person → Org`).
3. **Attributes vs entities**: if it has its own relationships it is an entity ("City"); if
   it is a value you filter on it is an attribute ("founding year").
4. **Type hierarchy only when queries need it.** Flat is easier to extract against.
5. **Validate against the competency questions** — walk each one through the schema on paper.
   Any question you cannot path through the schema means a missing type or relation.

Rules the engine enforces:
- Relations are **precise verbs**: `ACQUIRED`, `CITES`, `SUPERSEDES`, `DEPENDS_ON`. Never
  `RELATED_TO` — `kgraph.declare_relation` rejects the vague set outright. An untyped edge
  carries one bit and the meaning of a traversal dies with it.
- If two entity types are always queried together, merge them.
- If one type keeps needing a qualifier attribute to disambiguate usage
  (`role: "author"|"editor"`), split it into two relation types instead.
- Name entities canonically at modeling time and state the rule; fusion enforces it.

```bash
swarm.sh kg --op init --graph-name <n> --spec ontology.json   # or start from the built-in starter
swarm.sh kg --op ontology --graph-name <n>
```

**Ontology learning** (LLM shortcut that keeps the discipline): give a panelist 3–5
representative documents, ask for entity/relation types **with evidence quotes**, then prune
manually to the minimal set that answers the competency questions. Never auto-accept an
induced schema — induced ontologies overfit their sample.

## 4–6 · Extraction (entities, relations, events)

**Match the method to the source.** Using NLP on data that is already structured is the
classic beginner waste:
- **Structured** (databases, CSVs, APIs) → direct column→type mapping. Deterministic code.
- **Semi-structured** (HTML tables, infoboxes, JSON) → parsers per layout family; a model
  only for the messy cells.
- **Unstructured** (text, transcripts, PDFs) → the extraction passes below.

Run **one pass per stage**, not one mega-prompt. As a task graph: fan out over chunks
(`for_each`), one node per chunk, then a `reduce`, then ingest. Overlap chunks by 10–15% so
sentence-boundary entities are not lost; fusion reconciles the overlap later.

**Entity pass** — extract with the ontology verbatim in the prompt:
```
You are extracting knowledge for a graph with this ontology:
<ontology>
From the text below, extract every entity matching the ontology types.
For each: {surface, canonical, type, evidence: "<exact sentence>", confidence: high|med|low}
Rules:
- Only types from the ontology. Unknown-but-recurring concepts -> list separately as "candidates".
- Evidence must be a verbatim quote containing the mention.
- Do NOT merge distinct mentions; deduplication happens later.
<text>
```
Nested and discontinuous mentions ("University of California, Berkeley professor John Smith")
and type ambiguity ("Apple") drive most errors — requiring an evidence sentence forces
disambiguation from context.

**Relation pass** — adds the recognized-entity list and the relation inventory with
domain/range, plus: *"assert only relations the evidence sentence states directly."* Extract
relations **only between entities that passed the entity pass** — never let relation
extraction invent entities (the engine rejects that outright). Co-occurrence is not
assertion: "Musk discussed Twitter" is not `OWNS`.

**Event pass** — for dynamic domains (news, incidents, transactions). An event is a
**trigger** + **typed arguments** + a time anchor, stored as a first-class node with edges to
its arguments. Never flatten a 4-argument event into 6 pairwise edges — you lose which
acquisition happened at which price. Event-logic graphs (nodes are events, edges are
causal/temporal/conditional) are the right build when the question is "what leads to what".

Keep un-modeled but repeated relations in a `candidates` side-list; review them and promote
the real ones into the ontology rather than forcing them into wrong types.

## 7 · Quality gate (before fusion)

Sample and score:
- **entity precision** — are extracted entities real and correctly typed?
- **relation precision** — does the source sentence actually assert the edge?

Target **≥90% precision on a 50-item sample** before proceeding. Fix the prompt or the rules,
not the output, then re-run. Recall improves with more passes; **bad precision poisons the
graph permanently**. In a task graph this is a `verify` node plus a hand-checked sample — and
`kg --op lint` catches the structural half automatically.

Failure modes and their real causes:

| Symptom | Cause | Fix |
|---|---|---|
| graph full of `Concept`/`Thing` nodes | extracting without an ontology | stage 3 first, re-extract |
| the same person as 4 nodes | no canonical-form rule | define it, run fusion |
| confident wrong relations | co-occurrence treated as assertion | evidence-quote requirement + domain/range validation |
| events flattened to edge soup | no event schema | first-class event nodes with argument schemas |
| precision collapses at scale | prompt drift across document types | per-source-type prompts, gate per source |

## 8 · Fusion (never skip)

```bash
swarm.sh kg --op candidates --graph-name <n>       # scored pairs, with the layer breakdown
swarm.sh kg --op fuse       --graph-name <n>       # dry run: what WOULD merge
swarm.sh kg --op fuse       --graph-name <n> --apply
```

Three steps: **blocking** (never compare all pairs) → **matching** (string, attribute, and
crucially **neighborhood/structure** evidence) → **deterministic merge**. Bands: auto-merge
only above high confidence, auto-reject below low, and the middle band is **queued for
adjudication**, never merged silently. An erroneous merge is far more damaging than a missed
one — it silently fuses two entities' entire edge sets. Merges record `merged_from` so they
can be undone. Details: [graph-memory.md](graph-memory.md).

When fusing two *graphs* rather than instances, align schemas first: map entity and relation
types with a model, verify with instance overlap (if source A's `Firm` nodes mostly match
source B's `Company` nodes, the mapping is confirmed), then translate B's edges through the
mapping before instance fusion.

## 9 · Serve to LLMs

GraphRAG retrieval, graph-as-memory, and multi-hop path answering:
[graph-memory.md](graph-memory.md).

```bash
swarm.sh kg --op query --graph-name <n> --question "..." [--as-of 2025-06-01]
```

---

## Working rules

- **Schema first, always.** If the user resists schema design, build the minimal 5-type
  ontology from 3 sample documents and show it for approval.
- **Provenance on every fact.** Non-negotiable; the linter warns on every fact without it.
- **Incremental over big-bang.** Push a 10-document pilot through all 9 stages before
  scaling. The pilot exposes ontology gaps at 1% of the cost.
- **LLM extraction is stage machinery, not the pipeline.** The model slots into stages 4–6;
  the surrounding schema, validation, and fusion are what make the output a knowledge graph.
