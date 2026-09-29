# Graph memory — typed edges, fusion, and serving the graph to a model

## Why the structure, not the similarity

Three ways to find things, and only one of them can follow a chain of reasoning:

- **Keyword search** finds notes containing a word. Fails when the answer uses other words.
- **Vector search** finds notes that are *about* similar things. Fails when the answer is
  spread across notes that are individually not similar to the question.
- **Graph traversal** starts at one node and walks the connections.

*"Why did we drop Redis for the job queue?"* Vector search returns ten chunks that mention
Redis, none of which explains the decision — because the decision lives in the structure: a
decision record, the thing it replaced, and the incident that triggered it. Three separate
notes. Similarity has no concept of "these three belong to one causal chain".

Traversal walks it:

```
hop 1:  [job-queue]  --AFFECTED_BY-->  [ADR-007 Postgres queue]
hop 2:  [ADR-007]    --SUPERSEDES-->   [ADR-003 Redis queue]
hop 3:  [ADR-003]    --CAUSED_BY^-1--> [INC-2026-03-11]
```

Three nodes, ~1,000 tokens, causal chain intact.

One sentence to keep: **vector search finds things that sound like your question; graphs find
things that are connected to your answer.**

## Typed edges are the whole game

An untyped edge says "these two are related" — one bit. A typed edge says *how*.

Run the example untyped and the traversal becomes "the queue is related to a decision, which
is related to another decision, which is related to an incident." Did ADR-007 replace ADR-003
or the other way round? Did the incident cause the decision or the decision cause the
incident? The chain survives; the meaning is gone, and the model has to re-read every source
and guess.

`kgraph.py` enforces this: relation names must be `UPPER_SNAKE_CASE` verbs, the vague set
(`RELATED_TO`, `HAS_LINK`, `ASSOCIATED_WITH`, …) is rejected at declaration time, and every
relation carries `domain`/`range` that are validated in code on every write.

## Entity resolution is the expensive part

Deciding that "Dr. John Smith", "J. Smith" and "John" are one node — and that "Mercury the
planet" and "Mercury the element" are two. Extraction pipelines get this wrong constantly,
and the errors **compound multiplicatively over hops**:

| per-hop accuracy | 3 hops | 5 hops |
|---|---|---|
| 95% | 86% | 77% |
| 85% | 61% | 44% |

At 85% per hop, an impressive 5-hop traversal is a coin flip wearing a suit. This flips the
build order: the expensive part of graph engineering is not graph algorithms, it is deciding
what is the same thing.

Which is why **human-curated links are worth so much**: when someone writes `[[ADR-007]]`,
entity resolution is done by construction — no fuzzy merging, no compounding error. If the
source material already has curated links (a wiki, an Obsidian vault, ADR cross-references),
ingest those as edges directly and spend your extraction budget elsewhere.

### The fusion machinery

1. **Blocking** — never compare all pairs (O(n²)). Group cheaply first: same type plus a
   shared normalized key, an acronym expansion, or a shared token. Only pairs inside a block
   get a full comparison.
2. **Matching** — layered evidence, weighted by what is actually available:
   - *string*: normalized / alias / acronym match;
   - *attribute*: compatible attributes (same email domain, same founding year) —
     **contradicting** attributes cut the score in half, because a conflict is evidence
     against a merge;
   - *structure* (what naive dedup misses): compare **neighborhoods**. Two "J. Smith" nodes
     sharing three coauthors and an affiliation are one person; identical names with disjoint
     neighborhoods are not — those land in `review`, never `merge`.
   - LLM adjudication for the ambiguous middle band only — cheap heuristics decide the clear
     cases; the model sees both nodes' attributes, neighborhoods, and evidence quotes.
3. **Merge policy** — deterministic code, not model judgment: keep the canonical name, union
   aliases and edges, keep conflicting attribute values **per source** rather than silently
   overwriting (a conflict is signal), record `merged_from` for undo.

Two mentions of the same name from **different sources stay two nodes** at write time. That
is deliberate: collapsing them on write is an automatic erroneous merge, and an erroneous
merge is far worse than a missed one.

## Bitemporal facts: supersede, never overwrite

Every edge carries `valid_from` / `valid_until` (when the fact was true) alongside `source` /
`extracted_at` (when the system learned it). When new information contradicts an old edge,
the old edge is **not deleted** — its validity interval is closed and the new edge takes over:

```bash
swarm.sh kg --op query --graph-name g --question "..." --as-of 2025-06-01
```

The graph can then answer both "where do they work" and "where did they work in 2024" from
one store. A vector store can only overwrite or duplicate; it has no native concept of "this
was true until May". Any long-lived knowledge base has this shape — decisions supersede
decisions, claims go stale — and a system that cannot represent "X replaced Y on this date"
slowly fills with contradictions that an agent will confidently cite half of.

**Contradiction handling in a memory loop:** keep both facts with time and provenance and
prefer the newer at retrieval time. Record the change; do not fight it.

## Serving it to a model

- **Retrieval:** entity-link the query → expand **k = 1–2 hops** (beyond 2 is noise without
  re-ranking) → serialize the subgraph → that is the context.
- **Serialization that works:** `(head) -[REL {time, source}]-> (tail)` lines grouped by head
  and deduplicated. Tables of triples beat prose summaries because the model can quote exact
  facts. `kgraph.serialize()` emits exactly this, with type, aliases, validity interval,
  source, and confidence.
- **Multi-hop questions:** retrieve the **path** between the query's entities, not the
  neighborhood around each. The path IS the answer skeleton; the model narrates it.
- **Community summaries** for "what are the big themes" questions: cluster offline, summarize
  per cluster, retrieve summaries at query time.
- **Route by question type.** `kg --op query` reports honestly when the graph is the wrong
  tool: nothing linked → use text/vector search; a single-hop neighborhood → plain search is
  cheaper and just as accurate. Take that recommendation seriously.

## The graph-as-memory loop

1. After each session, run extraction (stages 4–6) over what is new, with the same ontology.
2. Fuse into the existing graph (stage 8) — same blocking/matching/merge machinery,
   incremental.
3. At session start or on demand, retrieve via query — never dump the whole graph into
   context.
4. On contradiction, keep both with time and provenance; prefer the newer at retrieval.
5. Periodic hygiene: re-run `--op lint` and `--op fuse`, re-score stale confidences.
   Unmaintained memory graphs rot exactly the way unfused extractions do.

## What the linter checks

`swarm.sh kg --op lint --graph-name <n>` — the check that error compounding makes essential:
unknown entity/relation types, dangling edge targets, domain/range violations, missing or
asymmetric inverses, contradiction cycles (`X SUPERSEDES Y SUPERSEDES X`), facts with neither
source nor evidence quote, inverted validity intervals, unfused duplicate suspects, and
orphan entities. Errors mean the graph will answer wrongly; warnings mean it will answer
thinly.

## Honest framing of the benchmark claims

The published comparisons, as their authors report them: graph methods win **multi-hop**
reasoning (e.g. 53.4% vs 42.9% on GraphRAG-Bench; HippoRAG 2 ~9.5 F1 points over a strong
embedding baseline on 2WikiMultiHopQA), **temporal** reasoning (the widest margins in the
field), and **corpus-wide synthesis**. They lose on **simple fact lookup** (~60.1% vs 60.9%
for plain vector RAG — the graph adds redundant context and wins nothing) and on **cost**
(one reported global-search configuration burned ~331K tokens per query against ~880 for
vector RAG; efficient graph systems run ~1K).

Two warnings that matter more than the numbers:

1. **Never trust a system evaluated only by its authors.** LightRAG posted large wins on its
   own benchmark and collapsed under independent evaluation.
2. **Graphs are a tool, not a religion.** In Mem0's own paper the graph variant *lost* to the
   non-graph variant on multi-hop questions.

The practitioner consensus is the same as this file's advice: **route by question type** —
vector for lookups, graph for chains — and never quote a figure you have not traced to a
primary source. (Related: a widely-shared "$3.1M Stanford and Anthropic study" cited during
the July 2026 graph-engineering wave does not exist. If a number is load-bearing for a
decision, find the paper.)
