"""KGraph — Fusion's knowledge-graph store (the memory half of graph engineering).

Vector search finds things that *sound like* your question. A graph finds things
that are *connected to* your answer. That is the whole case for this module: an
agent asking "why did we drop Redis for the job queue" needs a causal chain
(decision -> superseded decision -> incident) that lives in the structure, not in
any one chunk's similarity to the question.

Design commitments, each one load-bearing:

  * **Typed edges.** `SUPERSEDES`, `CAUSED`, `DEPENDS_ON`, `DECIDED_BY` — never
    `RELATED_TO`. An untyped edge carries one bit ("these are related") and the
    meaning of a traversal dies with it. Every relation declares domain/range,
    and an edge whose endpoints have the wrong types is **rejected in code**.
    That single validation removes most hallucinated structure.
  * **Provenance on every fact.** source, extracted_at, confidence. Non-
    negotiable: fusion and trust both depend on it, and retrofitting it after
    the fact is effectively impossible.
  * **Bitemporal facts.** Facts change; a store that can only overwrite fills
    with contradictions. A superseded edge is not deleted — its validity
    interval is closed and the new edge takes over, so the graph can answer both
    "where do they work" and "where did they work in 2024".
  * **Fusion before storing.** "SEU" / "Southeast University" are one entity.
    An unfused graph answers multi-hop queries wrongly *with confidence*,
    because paths break at duplicate boundaries. Blocking -> layered matching
    (string / attribute / **neighborhood**) -> deterministic merge with
    `merged_from` so any merge can be undone. An erroneous merge is far more
    damaging than a missed one: it silently fuses two entities' whole edge sets.
  * **Honest retrieval.** k-hop expansion and path finding, serialized as
    compact triples with provenance. Simple single-hop lookups do not need this
    and the store says so — a graph has to earn its maintenance cost.

Stdlib only. The store is line-oriented JSON under ``~/.fusion/graph/<name>/``
so it is greppable, diffable, and survives plugin updates.
"""
from __future__ import annotations

import json
import os
import re
import unicodedata
from collections import defaultdict, deque
from pathlib import Path
from typing import Optional

# Relation names are verbs, upper snake case. A vague name makes every
# downstream query ambiguous, so the shape is enforced.
_REL_RE = re.compile(r"^[A-Z][A-Z0-9_]*$")
_VAGUE_RELATIONS = {"RELATED_TO", "RELATES_TO", "HAS_LINK", "LINKED_TO", "ASSOCIATED_WITH",
                    "CONNECTED_TO", "REFERS_TO_SOMETHING", "SEE_ALSO"}

# A starter vocabulary that covers the questions flat retrieval actually fails:
# who decided X, what replaced it, what broke because of it.
STARTER_ONTOLOGY = {
    "entities": {
        "Person": {"desc": "an individual"},
        "Team": {"desc": "a group of people"},
        "Component": {"desc": "a deployable or importable unit of the system"},
        "Decision": {"desc": "a recorded decision (ADR, RFC, ticket resolution)"},
        "Incident": {"desc": "a failure event"},
        "Document": {"desc": "a source document"},
    },
    "relations": {
        "DECIDED_BY": {"domain": "Decision", "range": "Person"},
        "SUPERSEDES": {"domain": "Decision", "range": "Decision", "inverse": "SUPERSEDED_BY"},
        "SUPERSEDED_BY": {"domain": "Decision", "range": "Decision", "inverse": "SUPERSEDES"},
        "CAUSED": {"domain": "Decision", "range": "Incident", "inverse": "CAUSED_BY"},
        "CAUSED_BY": {"domain": "Incident", "range": "Decision", "inverse": "CAUSED"},
        "AFFECTS": {"domain": "Decision", "range": "Component"},
        "DEPENDS_ON": {"domain": "Component", "range": "Component"},
        "OWNS": {"domain": "Team", "range": "Component"},
        "MEMBER_OF": {"domain": "Person", "range": "Team"},
        "EVIDENCED_BY": {"domain": "Decision", "range": "Document"},
    },
    "canonical_form": "trimmed original casing; aliases hold the variants",
}

DEFAULT_ROOT = Path(os.environ.get("FUSION_GRAPH_HOME",
                                   Path.home() / ".fusion" / "graph"))

# Matching bands. Auto-merge only above high confidence; auto-reject below low;
# the middle band is queued for adjudication, never silently merged.
AUTO_MERGE = 0.85
REVIEW_FLOOR = 0.55


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

def normalize(s: str) -> str:
    s = unicodedata.normalize("NFKC", (s or "")).lower().strip()
    s = re.sub(r"[^\w\s]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def acronym(s: str) -> str:
    words = [w for w in normalize(s).split() if w]
    return "".join(w[0] for w in words) if len(words) > 1 else ""


def tokens(s: str) -> set:
    return {t for t in normalize(s).split() if len(t) > 2}


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


# --------------------------------------------------------------------------
# store
# --------------------------------------------------------------------------

class KGraph:
    """A typed, provenanced, bitemporal property graph on disk.

    Entities: {id, type, name, aliases[], attrs{}, source, extracted_at,
               confidence, merged_from[]}
    Edges:    {id, head, rel, tail, attrs{}, source, extracted_at, confidence,
               valid_from, valid_until, superseded_by}
    """

    def __init__(self, name: str = "default", root: Optional[Path] = None,
                 ontology: Optional[dict] = None):
        self.name = name
        self.dir = Path(root or DEFAULT_ROOT) / name
        self.entities: dict = {}
        self.edges: dict = {}
        self.ontology = ontology or dict(STARTER_ONTOLOGY)
        self._loaded = False

    # --- persistence -------------------------------------------------------

    @property
    def paths(self) -> dict:
        return {"entities": self.dir / "entities.jsonl",
                "edges": self.dir / "edges.jsonl",
                "ontology": self.dir / "ontology.json"}

    def load(self) -> "KGraph":
        p = self.paths
        if p["ontology"].exists():
            self.ontology = json.loads(p["ontology"].read_text(encoding="utf-8"))
        for key, target in (("entities", self.entities), ("edges", self.edges)):
            if p[key].exists():
                for line in p[key].read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        rec = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    target[rec["id"]] = rec
        self._loaded = True
        return self

    def save(self) -> "KGraph":
        self.dir.mkdir(parents=True, exist_ok=True)
        p = self.paths
        p["ontology"].write_text(json.dumps(self.ontology, indent=2, ensure_ascii=False),
                                 encoding="utf-8")
        for key, src in (("entities", self.entities), ("edges", self.edges)):
            p[key].write_text(
                "\n".join(json.dumps(v, ensure_ascii=False, sort_keys=True)
                          for _, v in sorted(src.items())) + ("\n" if src else ""),
                encoding="utf-8")
        return self

    # --- ontology ----------------------------------------------------------

    def entity_types(self) -> dict:
        return self.ontology.get("entities", {})

    def relation_types(self) -> dict:
        return self.ontology.get("relations", {})

    def declare_entity_type(self, name: str, desc: str = "") -> None:
        self.ontology.setdefault("entities", {})[name] = {"desc": desc}

    def declare_relation(self, rel: str, domain: str, rng: str,
                         inverse: str = "") -> list:
        """Declare a typed relation. Returns validation errors (empty = ok)."""
        errs = []
        if not _REL_RE.match(rel):
            errs.append(f"relation {rel!r} must be UPPER_SNAKE_CASE — a precise verb")
        if rel in _VAGUE_RELATIONS:
            errs.append(f"relation {rel!r} is vague; name what the edge actually asserts "
                        "(SUPERSEDES, CAUSED, DEPENDS_ON) — an untyped edge carries one bit")
        for t in (domain, rng):
            if t not in self.entity_types():
                errs.append(f"unknown entity type {t!r} — declare it before using it in {rel}")
        if errs:
            return errs
        spec = {"domain": domain, "range": rng}
        if inverse:
            spec["inverse"] = inverse
        self.ontology.setdefault("relations", {})[rel] = spec
        return []

    # --- writes ------------------------------------------------------------

    def _eid(self, etype: str, name: str, source: str = "") -> str:
        """Node id for one *mention*, not one name. Two sources saying "J. Smith"
        get two nodes; deciding whether they are one person is fusion's job
        (stage 8), not the writer's. Collapsing them here would be an automatic
        erroneous merge — the failure mode that silently fuses two entities'
        entire edge sets. Re-ingesting the same source stays idempotent."""
        base = f"{etype}:{normalize(name).replace(' ', '_') or 'unnamed'}"
        existing = self.entities.get(base)
        if existing is None or (existing.get("source") or "") == (source or ""):
            return base
        slug = re.sub(r"[^a-z0-9]+", "_", normalize(source)).strip("_")[:24] or "alt"
        cand, n = f"{base}@{slug}", 2
        while (cand in self.entities
               and (self.entities[cand].get("source") or "") != (source or "")):
            cand, n = f"{base}@{slug}{n}", n + 1
        return cand

    def add_entity(self, etype: str, name: str, attrs: Optional[dict] = None,
                   source: str = "", extracted_at: str = "", confidence: float = 1.0,
                   aliases: Optional[list] = None, strict: bool = True) -> dict:
        """Add or update an entity. Fails closed on unknown types when strict —
        a graph full of `Concept`/`Thing` nodes is a word cloud with arrows."""
        if strict and etype not in self.entity_types():
            raise ValueError(f"unknown entity type {etype!r}; declare it in the ontology first")
        eid = self._eid(etype, name, source)
        rec = self.entities.get(eid) or {
            "id": eid, "type": etype, "name": name.strip(), "aliases": [],
            "attrs": {}, "source": source, "extracted_at": extracted_at,
            "confidence": float(confidence), "merged_from": [],
        }
        for a in (aliases or []):
            if a and a not in rec["aliases"] and normalize(a) != normalize(rec["name"]):
                rec["aliases"].append(a)
        for k, v in (attrs or {}).items():
            rec["attrs"][k] = v
        if source:
            rec["source"] = source
        if extracted_at:
            rec["extracted_at"] = extracted_at
        self.entities[eid] = rec
        return rec

    def add_edge(self, head: str, rel: str, tail: str, attrs: Optional[dict] = None,
                 source: str = "", extracted_at: str = "", confidence: float = 1.0,
                 evidence: str = "", valid_from: str = "", valid_until: str = "",
                 strict: bool = True) -> dict:
        """Add a typed edge. Domain/range are validated in code: an
        `EMPLOYED_BY` from Org -> Org is auto-rejected, and an edge with no
        evidence is a hallucination with extra steps."""
        rels = self.relation_types()
        if strict:
            if rel not in rels:
                raise ValueError(f"unknown relation {rel!r}; declare it (with domain/range) first")
            for end, node_id in (("head", head), ("tail", tail)):
                if node_id not in self.entities:
                    raise ValueError(f"{end} {node_id!r} is not an entity in this graph "
                                     "— relation extraction must never invent entities")
            spec = rels[rel]
            ht, tt = self.entities[head]["type"], self.entities[tail]["type"]
            if spec.get("domain") and ht != spec["domain"]:
                raise ValueError(f"{rel} domain is {spec['domain']}, got {ht} ({head})")
            if spec.get("range") and tt != spec["range"]:
                raise ValueError(f"{rel} range is {spec['range']}, got {tt} ({tail})")
        eid = f"{head}|{rel}|{tail}"
        rec = {
            "id": eid, "head": head, "rel": rel, "tail": tail,
            "attrs": dict(attrs or {}), "source": source, "extracted_at": extracted_at,
            "confidence": float(confidence), "evidence": evidence,
            "valid_from": valid_from, "valid_until": valid_until, "superseded_by": "",
        }
        self.edges[eid] = rec
        return rec

    def supersede(self, old_edge_id: str, new_edge_id: str, at: str = "") -> bool:
        """Close an old fact's validity instead of deleting it. Facts change;
        the graph records the change rather than fighting it."""
        old = self.edges.get(old_edge_id)
        if not old:
            return False
        old["valid_until"] = at or old.get("valid_until") or ""
        old["superseded_by"] = new_edge_id
        return True

    def active_edges(self, as_of: str = "") -> list:
        """Edges valid at `as_of` (empty -> current). A fact whose interval has
        closed is still stored; it is simply not current."""
        out = []
        for e in self.edges.values():
            if as_of:
                if e.get("valid_from") and e["valid_from"] > as_of:
                    continue
                if e.get("valid_until") and e["valid_until"] <= as_of:
                    continue
            elif e.get("superseded_by") or e.get("valid_until"):
                continue
            out.append(e)
        return out

    # --- fusion (blocking -> matching -> merge) ----------------------------

    def blocks(self) -> dict:
        """Group candidates cheaply so matching is not O(n^2): same type plus a
        shared normalized key, acronym expansion, or a shared token."""
        buckets: dict = defaultdict(set)
        for e in self.entities.values():
            t = e["type"]
            buckets[(t, "n", normalize(e["name"]))].add(e["id"])
            ac = acronym(e["name"])
            if ac:
                buckets[(t, "a", ac)].add(e["id"])
            if len(normalize(e["name"])) <= 6:
                buckets[(t, "a", normalize(e["name"]))].add(e["id"])
            for alias in e.get("aliases", []):
                buckets[(t, "n", normalize(alias))].add(e["id"])
            for tok in list(tokens(e["name"]))[:4]:
                buckets[(t, "t", tok)].add(e["id"])
        return {k: sorted(v) for k, v in buckets.items() if len(v) > 1}

    def neighbors(self, eid: str) -> set:
        out = set()
        for e in self.edges.values():
            if e["head"] == eid:
                out.add((e["rel"], e["tail"]))
            elif e["tail"] == eid:
                out.add((e["rel"] + "^-1", e["head"]))
        return out

    def match_score(self, a_id: str, b_id: str) -> dict:
        """Layered evidence. The structure layer is what naive dedup misses:
        two 'J. Smith' nodes sharing coauthors and an affiliation are one
        person; identical names with disjoint neighborhoods are not."""
        a, b = self.entities[a_id], self.entities[b_id]
        if a["type"] != b["type"]:
            return {"score": 0.0, "layers": {}, "band": "reject"}
        na, nb = normalize(a["name"]), normalize(b["name"])
        alias_hit = (na in {normalize(x) for x in b.get("aliases", [])} or
                     nb in {normalize(x) for x in a.get("aliases", [])})
        string = 1.0 if (na == nb or alias_hit) else max(
            _jaccard(tokens(a["name"]), tokens(b["name"])),
            0.8 if (acronym(a["name"]) == nb or acronym(b["name"]) == na) and na and nb else 0.0,
        )
        shared_attrs = set(a["attrs"]) & set(b["attrs"])
        if shared_attrs:
            agree = sum(1 for k in shared_attrs
                        if normalize(str(a["attrs"][k])) == normalize(str(b["attrs"][k])))
            attribute = agree / len(shared_attrs)
        else:
            attribute = 0.0
        na_set, nb_set = self.neighbors(a_id), self.neighbors(b_id)
        structure = _jaccard(na_set, nb_set)
        conflict = bool(shared_attrs) and attribute == 0.0
        # Weight only the layers that actually carry evidence. Fixed weights
        # would cap an isolated pair of identical names below the reject floor
        # purely for having no attributes or neighbors yet — the graph would
        # then never propose the duplicates it most obviously has.
        weights = {"string": 0.5}
        if shared_attrs:
            weights["attribute"] = 0.2
        if na_set or nb_set:
            weights["structure"] = 0.3
        vals = {"string": string, "attribute": attribute, "structure": structure}
        score = sum(w * vals[k] for k, w in weights.items()) / sum(weights.values())
        if conflict:
            score *= 0.5     # contradicting attributes are evidence AGAINST a merge
        band = ("merge" if score >= AUTO_MERGE else
                "review" if score >= REVIEW_FLOOR else "reject")
        return {"score": round(score, 3),
                "layers": {"string": round(string, 3), "attribute": round(attribute, 3),
                           "structure": round(structure, 3), "conflict": conflict},
                "band": band}

    def candidates(self) -> list:
        """Every within-block pair with its score and band, best first. The
        review band is for adjudication (LLM or human), never auto-merged."""
        pairs, seen = [], set()
        for ids in self.blocks().values():
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    key = (ids[i], ids[j])
                    if key in seen:
                        continue
                    seen.add(key)
                    m = self.match_score(*key)
                    if m["band"] != "reject":
                        pairs.append({"a": key[0], "b": key[1], **m})
        return sorted(pairs, key=lambda p: -p["score"])

    def merge(self, keep_id: str, drop_id: str) -> dict:
        """Deterministic merge — code, not model judgment. Canonical name from
        `keep`, union of aliases and edges, conflicting attribute values kept
        per-source (a conflict is signal, not noise), `merged_from` recorded so
        the merge can be undone."""
        keep, drop = self.entities[keep_id], self.entities[drop_id]
        if keep["type"] != drop["type"]:
            raise ValueError("refusing to merge across entity types")
        for alias in [drop["name"], *drop.get("aliases", [])]:
            if alias and normalize(alias) != normalize(keep["name"]) and alias not in keep["aliases"]:
                keep["aliases"].append(alias)
        for k, v in drop["attrs"].items():
            if k not in keep["attrs"]:
                keep["attrs"][k] = v
            elif normalize(str(keep["attrs"][k])) != normalize(str(v)):
                keep["attrs"].setdefault("_conflicts", {}).setdefault(k, []).append(
                    {"value": v, "source": drop.get("source", "")})
        keep["merged_from"] = keep.get("merged_from", []) + [
            {"id": drop_id, "name": drop["name"], "source": drop.get("source", "")}]
        rewired = 0
        for e in list(self.edges.values()):
            if drop_id not in (e["head"], e["tail"]):
                continue
            self.edges.pop(e["id"], None)
            e["head"] = keep_id if e["head"] == drop_id else e["head"]
            e["tail"] = keep_id if e["tail"] == drop_id else e["tail"]
            if e["head"] == e["tail"]:
                continue          # self-loop created by the merge — drop it
            e["id"] = f"{e['head']}|{e['rel']}|{e['tail']}"
            self.edges[e["id"]] = e
            rewired += 1
        self.entities.pop(drop_id, None)
        return {"kept": keep_id, "dropped": drop_id, "edges_rewired": rewired,
                "aliases": list(keep["aliases"])}

    def fuse(self, auto: bool = True) -> dict:
        """Run the fusion pass. Only the `merge` band is applied automatically;
        the `review` band is returned for adjudication."""
        merged, review = [], []
        for pair in self.candidates():
            if pair["band"] == "merge" and auto:
                a, b = pair["a"], pair["b"]
                if a in self.entities and b in self.entities:
                    merged.append({**self.merge(a, b), "score": pair["score"]})
            elif pair["band"] == "review":
                review.append(pair)
        return {"merged": merged, "review": review,
                "note": "review band needs adjudication — an erroneous merge silently "
                        "fuses two entities' entire edge sets and is far worse than a missed one"}

    # --- retrieval ---------------------------------------------------------

    def _adjacency(self, as_of: str = "") -> dict:
        adj = defaultdict(list)
        for e in self.active_edges(as_of):
            adj[e["head"]].append((e["tail"], e, False))
            adj[e["tail"]].append((e["head"], e, True))
        return adj

    def find(self, text: str, etype: str = "") -> list:
        """Entity-link a query string: exact/alias match, then a contained
        mention (identifiers like ``INC-2026-03-11`` or ``ADR-003`` appear
        inside a sentence and would never match it whole), then token overlap.
        Linking is where multi-hop retrieval succeeds or quietly degrades into
        a one-hop neighborhood, so all three passes matter."""
        n = normalize(text)
        exact, contained, fuzzy = [], [], []
        for e in self.entities.values():
            if etype and e["type"] != etype:
                continue
            names = [normalize(x) for x in [e["name"], *e.get("aliases", [])] if x]
            if any(x == n for x in names):
                exact.append(e["id"])
            elif any(len(x) >= 4 and re.search(rf"(?<!\w){re.escape(x)}(?!\w)", n) for x in names):
                contained.append(e["id"])
            elif _jaccard(tokens(text), tokens(e["name"])) >= 0.5:
                fuzzy.append(e["id"])
        return exact + contained + fuzzy

    def khop(self, seeds, k: int = 2, as_of: str = "") -> dict:
        """Expand k hops from the seeds. k=1-2; beyond 2 is noise without
        re-ranking, so the default stops there."""
        adj = self._adjacency(as_of)
        seeds = [s for s in ([seeds] if isinstance(seeds, str) else seeds) if s in self.entities]
        seen, frontier, edges = set(seeds), list(seeds), {}
        for _ in range(max(0, int(k))):
            nxt = []
            for node in frontier:
                for other, edge, _rev in adj.get(node, []):
                    edges[edge["id"]] = edge
                    if other not in seen:
                        seen.add(other)
                        nxt.append(other)
            frontier = nxt
            if not frontier:
                break
        return {"entities": sorted(seen), "edges": sorted(edges)}

    def path(self, src: str, dst: str, max_hops: int = 4, as_of: str = "") -> list:
        """Shortest typed path between two entities. For a multi-hop question
        the path IS the answer skeleton; the model only narrates it."""
        if src not in self.entities or dst not in self.entities:
            return []
        adj = self._adjacency(as_of)
        q, seen = deque([(src, [])]), {src}
        while q:
            node, trail = q.popleft()
            if len(trail) >= max_hops:
                continue
            for other, edge, rev in adj.get(node, []):
                if other in seen:
                    continue
                step = trail + [{"from": node, "rel": edge["rel"], "to": other,
                                 "reverse": rev, "edge": edge["id"],
                                 "source": edge.get("source", "")}]
                if other == dst:
                    return step
                seen.add(other)
                q.append((other, step))
        return []

    def serialize(self, entity_ids=None, edge_ids=None, as_of: str = "") -> str:
        """Compact triples grouped by head, with time and provenance. Tables of
        triples beat prose summaries — the model can quote exact facts."""
        ents = set(entity_ids or self.entities)
        edges = [self.edges[e] for e in (edge_ids or [])] if edge_ids else self.active_edges(as_of)
        by_head = defaultdict(list)
        for e in edges:
            if e["head"] in ents or e["tail"] in ents:
                by_head[e["head"]].append(e)
        lines = []
        for head in sorted(by_head):
            h = self.entities.get(head, {})
            label = h.get("name", head)
            alias = f" (aka {', '.join(h.get('aliases', []))})" if h.get("aliases") else ""
            lines.append(f"{label} [{h.get('type', '?')}]{alias}")
            for e in sorted(by_head[head], key=lambda x: (x["rel"], x["tail"])):
                t = self.entities.get(e["tail"], {})
                meta = []
                if e.get("valid_from") or e.get("valid_until"):
                    meta.append(f"{e.get('valid_from') or '…'}→{e.get('valid_until') or 'now'}")
                if e.get("source"):
                    meta.append(f"src={e['source']}")
                if e.get("confidence", 1.0) < 1.0:
                    meta.append(f"conf={e['confidence']}")
                suffix = f" {{{'; '.join(meta)}}}" if meta else ""
                lines.append(f"  -[{e['rel']}]-> {t.get('name', e['tail'])}"
                             f" [{t.get('type', '?')}]{suffix}")
        return "\n".join(lines)

    def answer_context(self, question: str, k: int = 2, as_of: str = "") -> dict:
        """Retrieval for one question. Reports honestly when the graph is not
        the right tool: a single-hop lookup does not need a traversal, and a
        question that links to nothing should fall back to text search."""
        seeds = list(self.find(question))
        for chunk in re.split(r"[,?]| and | vs ", question):
            seeds.extend(self.find(chunk.strip()))
        seeds = list(dict.fromkeys(seeds))
        if not seeds:
            return {"seeds": [], "context": "", "hops": 0,
                    "recommendation": "no entity linked — use text/vector search, not the graph"}
        paths = []
        for i in range(len(seeds)):
            for j in range(i + 1, len(seeds)):
                p = self.path(seeds[i], seeds[j], as_of=as_of)
                if p:
                    paths.append(p)
        sub = self.khop(seeds, k=k, as_of=as_of)
        rec = ("multi-hop — the path between the linked entities is the answer skeleton"
               if paths else
               "single-hop neighborhood — if this is a plain fact lookup, plain search is "
               "cheaper and just as accurate")
        return {"seeds": seeds, "paths": paths, "hops": max((len(p) for p in paths), default=1),
                "context": self.serialize(sub["entities"], sub["edges"], as_of=as_of),
                "recommendation": rec}

    # --- linter ------------------------------------------------------------

    def lint(self) -> list:
        """Validate the graph itself: unknown types, dangling targets, missing
        inverses, contradiction cycles, missing provenance, duplicate suspects.

        This is the check that entity-resolution error compounding makes
        essential: at 95% per-hop accuracy a 5-hop chain is ~77% trustworthy;
        at 85% it is ~44% — a coin flip wearing a traversal.
        """
        out = []

        def add(level, code, ref, msg):
            out.append({"level": level, "code": code, "ref": ref, "msg": msg})

        etypes, rtypes = self.entity_types(), self.relation_types()
        for e in self.entities.values():
            if e["type"] not in etypes:
                add("error", "unknown_entity_type", e["id"],
                    f"type {e['type']!r} is not in the ontology")
            if not e.get("source"):
                add("warn", "no_provenance", e["id"],
                    "entity has no source — fusion and trust both depend on provenance")
        for r, spec in rtypes.items():
            if r in _VAGUE_RELATIONS:
                add("warn", "vague_relation", r,
                    "an untyped/vague relation carries one bit; name what it asserts")
            inv = spec.get("inverse")
            if inv and inv not in rtypes:
                add("error", "missing_inverse", r, f"declares inverse {inv!r} which is not declared")
            elif inv and rtypes[inv].get("inverse") != r:
                add("warn", "asymmetric_inverse", r,
                    f"{r}.inverse={inv} but {inv}.inverse={rtypes[inv].get('inverse')!r}")
        for e in self.edges.values():
            if e["rel"] not in rtypes:
                add("error", "unknown_relation", e["id"], f"relation {e['rel']!r} not in ontology")
                continue
            spec = rtypes[e["rel"]]
            for end, key in (("head", "domain"), ("tail", "range")):
                node = self.entities.get(e[end])
                if not node:
                    add("error", "dangling_target", e["id"],
                        f"{end} {e[end]!r} does not exist")
                elif spec.get(key) and node["type"] != spec[key]:
                    add("error", "type_violation", e["id"],
                        f"{e['rel']} {key} is {spec[key]}, got {node['type']}")
            if not e.get("source") and not e.get("evidence"):
                add("warn", "no_evidence", e["id"],
                    "edge asserts a relation with neither source nor evidence quote")
            if e.get("valid_until") and e.get("valid_from") and e["valid_until"] < e["valid_from"]:
                add("error", "bad_interval", e["id"], "valid_until precedes valid_from")
        # contradiction cycles: X SUPERSEDES Y SUPERSEDES X
        for rel, spec in rtypes.items():
            if rel not in ("SUPERSEDES", "CAUSED", "DEPENDS_ON"):
                continue
            adj = defaultdict(set)
            for e in self.edges.values():
                if e["rel"] == rel:
                    adj[e["head"]].add(e["tail"])
            for start in list(adj):
                stack, seen = [(start, [start])], set()
                while stack:
                    node, trail = stack.pop()
                    for nxt in adj.get(node, ()):
                        if nxt == start:
                            add("error", "contradiction_cycle", rel,
                                f"{rel} cycle: {' -> '.join(trail + [nxt])}")
                            stack = []
                            break
                        if nxt not in seen:
                            seen.add(nxt)
                            stack.append((nxt, trail + [nxt]))
        for pair in self.candidates():
            if pair["band"] == "merge":
                add("warn", "unfused_duplicate", f"{pair['a']} ~ {pair['b']}",
                    f"score {pair['score']} — run fusion before serving; paths break at "
                    "duplicate boundaries and multi-hop answers go wrong with confidence")
        consumed = {x for e in self.edges.values() for x in (e["head"], e["tail"])}
        for eid in self.entities:
            if eid not in consumed:
                add("warn", "orphan", eid, "entity participates in no edge")
        return out

    def stats(self) -> dict:
        by_type: dict = defaultdict(int)
        for e in self.entities.values():
            by_type[e["type"]] += 1
        by_rel: dict = defaultdict(int)
        for e in self.edges.values():
            by_rel[e["rel"]] += 1
        active = len(self.active_edges())
        return {"name": self.name, "dir": str(self.dir),
                "entities": len(self.entities), "edges": len(self.edges),
                "active_edges": active, "closed_edges": len(self.edges) - active,
                "entity_types": dict(sorted(by_type.items())),
                "relation_types": dict(sorted(by_rel.items())),
                "entity_types_declared": len(self.entity_types()),
                "relation_types_declared": len(self.relation_types())}


# --------------------------------------------------------------------------
# ingestion of extractor output (stages 4-6 land here)
# --------------------------------------------------------------------------

def ingest(kg: KGraph, payload, source: str = "", extracted_at: str = "",
           strict: bool = True) -> dict:
    """Load one extraction pass. Everything that fails validation is REJECTED
    and reported, never coerced — an edge whose endpoints have incompatible
    types is exactly the hallucinated structure this gate exists to stop.

    payload: {"entities": [{type, name, aliases?, attrs?, confidence?, evidence?}],
              "relations": [{head, rel, tail, evidence?, confidence?,
                             valid_from?, valid_until?}]}
    `head`/`tail` may be an entity id or a plain name (resolved within the pass).
    """
    if isinstance(payload, (str, Path)):
        p = Path(str(payload))
        payload = json.loads(p.read_text(encoding="utf-8") if p.exists() else str(payload))
    added_e, added_r, rejected = [], [], []
    local: dict = {}
    for item in payload.get("entities") or []:
        try:
            rec = kg.add_entity(
                item["type"], item["name"], attrs=item.get("attrs"),
                source=item.get("source") or source,
                extracted_at=item.get("extracted_at") or extracted_at,
                confidence=float(item.get("confidence", 1.0)),
                aliases=item.get("aliases"), strict=strict)
            local[normalize(item["name"])] = rec["id"]
            for a in item.get("aliases") or []:
                local.setdefault(normalize(a), rec["id"])
            added_e.append(rec["id"])
        except Exception as exc:  # noqa: BLE001
            rejected.append({"kind": "entity", "item": item, "why": str(exc)})

    def resolve(ref: str) -> str:
        if ref in kg.entities:
            return ref
        if normalize(ref) in local:
            return local[normalize(ref)]
        hits = kg.find(ref)
        return hits[0] if hits else ref

    for item in payload.get("relations") or []:
        try:
            rec = kg.add_edge(
                resolve(item["head"]), item["rel"], resolve(item["tail"]),
                attrs=item.get("attrs"), source=item.get("source") or source,
                extracted_at=item.get("extracted_at") or extracted_at,
                confidence=float(item.get("confidence", 1.0)),
                evidence=item.get("evidence", ""),
                valid_from=item.get("valid_from", ""),
                valid_until=item.get("valid_until", ""), strict=strict)
            added_r.append(rec["id"])
        except Exception as exc:  # noqa: BLE001
            rejected.append({"kind": "relation", "item": item, "why": str(exc)})
    return {"entities_added": added_e, "relations_added": added_r,
            "rejected": rejected, "rejected_count": len(rejected)}


# --------------------------------------------------------------------------
# CLI surface (driven by `python -m fusion_swarm kg --op ...`)
# --------------------------------------------------------------------------

def run(op: str = "stats", name: str = "default", question: str = "", spec=None,
        source: str = "", as_of: str = "", k: int = 2, apply: bool = False,
        head: str = "", rel: str = "", tail: str = "") -> dict:
    kg = KGraph(name).load()
    if op == "init":
        if spec:
            data = spec if isinstance(spec, dict) else json.loads(
                Path(str(spec)).read_text(encoding="utf-8")
                if Path(str(spec)).exists() else str(spec))
            kg.ontology = data
        kg.save()
        return {"op": "init", "ontology": kg.ontology, "dir": str(kg.dir)}
    if op == "stats":
        return {"op": "stats", **kg.stats()}
    if op == "ontology":
        return {"op": "ontology", "ontology": kg.ontology}
    if op == "ingest":
        res = ingest(kg, spec, source=source)
        kg.save()
        return {"op": "ingest", **res, "stats": kg.stats()}
    if op == "lint":
        issues = kg.lint()
        return {"op": "lint", "issues": issues,
                "errors": sum(1 for i in issues if i["level"] == "error"),
                "warnings": sum(1 for i in issues if i["level"] == "warn")}
    if op == "candidates":
        return {"op": "candidates", "pairs": kg.candidates()}
    if op == "fuse":
        res = kg.fuse(auto=apply)
        if apply:
            kg.save()
        return {"op": "fuse", "applied": bool(apply), **res}
    if op == "merge":
        res = kg.merge(head, tail)
        kg.save()
        return {"op": "merge", **res}
    if op == "query":
        return {"op": "query", **kg.answer_context(question, k=k, as_of=as_of)}
    if op == "path":
        return {"op": "path", "path": kg.path(head, tail, as_of=as_of)}
    if op == "serialize":
        return {"op": "serialize", "context": kg.serialize(as_of=as_of)}
    raise ValueError(f"unknown kg op {op!r}")
