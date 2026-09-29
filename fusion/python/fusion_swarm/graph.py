"""Graph — Fusion's graph-engineering engine (the execution half).

A chain is a graph too: the smallest, most fragile one you can draw. This module
runs the *wide* version — nodes are bounded jobs, edges are real data
dependencies, and independent work never waits on work it does not read.

What changed from the original port (`swarms.structs.GraphWorkflow`):

  1. **Dataflow scheduling, not waves.** The old engine ran topological *waves*:
     every node in a wave waited for the slowest node in that wave. Here a node
     fires the instant *its own* deps resolve, so a fast item can be three stages
     ahead of a slow one. Topology is the cost lever; barriers are opt-in
     (`require: "all"`), never the default.
  2. **Typed nodes.** work · verify · route · reduce · gate · human. Only the
     first three spend a model call. `reduce` is deterministic code (flatten,
     dedupe, count) — you never pay an agent to do your plumbing. `gate` runs a
     real check; a green test outranks any vote. `human` is a node: irreversible
     edges route through explicit approval.
  3. **Failure isolation.** A node that fails resolves to *absent* and its
     absence is stated to downstream nodes — it never crashes the run and it
     never silently reads as agreement.
  4. **Guardrails.** Node cap, call cap, per-node timeout, one-writer-per-file,
     loop rounds bounded, cycles rejected with the cycle path named.
  5. **Lint + plan before spend.** `lint()` finds fake edges, redundant edges,
     unneeded barriers, routers with one target, cycles. `plan()` prints the
     schedule, the critical path, and the estimated call count — the cheapest
     faithful environment to rehearse a topology in.
  6. **loop-until-dry.** A whole-graph `repeat` block re-runs until K
     consecutive rounds surface nothing new, deduping against **everything ever
     seen** (not just what survived verification — that is what makes a loop
     converge instead of rediscovering the same dead end forever).

Specs, two ways. Compact DSL (backwards compatible):
    nodes: "research=codex,analyze=copilot,verify=grok,merge=opencode"
    edges: "research>analyze,research>verify,analyze>merge,verify>merge"
A node may declare its kind inline: "verify=grok:verify,merge=:reduce".

Full JSON spec (`--spec graph.json`) when you need prompts, tiering, budgets:
    {"name": "...", "budget": {...}, "repeat": {...}, "nodes": [ {...}, ... ]}
"""
from __future__ import annotations

import json
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .adapter import dispatch
from .gate import run_gate

NODE_KINDS = ("work", "verify", "route", "reduce", "gate", "human")
REDUCE_OPS = ("concat", "dedupe", "count", "list")

# Node kinds that spend a model call (used by the cost estimate and the cap).
DISPATCHING_KINDS = ("work", "verify", "route")

DEFAULT_BUDGET = {
    "max_nodes": 64,      # hard cap on how many jobs one graph may spawn
    "max_calls": 200,     # hard cap on model calls across all rounds
    "max_rounds": 4,      # hard cap on repeat rounds
    "node_timeout": None,  # per-node seconds (None -> adapter default)
}

DEFAULT_REPEAT = {"max_rounds": 1, "stop_after_dry_rounds": 2}

# The verifier's job is to REFUTE. Diverse skeptics catch what identical ones
# cannot, so multi-voter verification rotates these lenses.
VERIFY_LENSES = (
    "correctness — is the claim actually true as stated?",
    "evidence — does the cited source/observation really support it?",
    "reproduction — would this reproduce, or is it a plausible story?",
    "security — does it hold under adversarial input or misuse?",
    "currency — is it still true today, or stale?",
)

_ID_RE = re.compile(r"^[A-Za-z0-9_.#-]+$")


# --------------------------------------------------------------------------
# spec model
# --------------------------------------------------------------------------

@dataclass
class Node:
    id: str
    kind: str = "work"
    provider: str = ""
    model: str = ""
    effort: str = ""
    deps: list = field(default_factory=list)
    require: str = "any"          # any -> resilient; all -> barrier
    prompt: str = ""
    for_each: Optional[list] = None
    item: str = ""                # set on expanded siblings
    writes: list = field(default_factory=list)
    targets: list = field(default_factory=list)   # route: candidate next nodes
    voters: int = 1               # verify: independent skeptics
    threshold: int = 0            # verify: refutations needed to kill (0 -> majority)
    op: str = "concat"            # reduce
    cmd: str = ""                 # gate
    cwd: str = ""                 # gate
    reason: str = ""              # human
    label: str = ""

    def dispatches(self) -> int:
        if self.kind == "verify":
            return max(1, int(self.voters or 1))
        return 1 if self.kind in DISPATCHING_KINDS else 0


def _as_list(v) -> list:
    if v is None:
        return []
    if isinstance(v, str):
        return [x.strip() for x in v.split(",") if x.strip()]
    return list(v)


def node_from_dict(d: dict) -> Node:
    n = Node(id=str(d.get("id", "")).strip())
    n.kind = str(d.get("kind", "work")).strip() or "work"
    n.provider = str(d.get("provider", "")).strip()
    n.model = str(d.get("model", "")).strip()
    n.effort = str(d.get("effort", "")).strip()
    n.deps = _as_list(d.get("deps") or d.get("input_nodes"))
    n.require = str(d.get("require", "any")).strip() or "any"
    n.prompt = str(d.get("prompt", ""))
    fe = d.get("for_each")
    n.for_each = [str(x) for x in fe] if isinstance(fe, list) else None
    n.writes = [str(x) for x in _as_list(d.get("writes"))]
    n.targets = _as_list(d.get("targets") or d.get("output_nodes"))
    n.voters = int(d.get("voters", 1) or 1)
    n.threshold = int(d.get("threshold", 0) or 0)
    n.op = str(d.get("op", "concat")).strip() or "concat"
    n.cmd = str(d.get("cmd", "") or d.get("gate_cmd", ""))
    n.cwd = str(d.get("cwd", "") or "")
    n.reason = str(d.get("reason", ""))
    n.label = str(d.get("label", ""))
    return n


def parse_nodes(spec: str) -> dict:
    """Compact DSL -> {id: provider}. Kept for backwards compatibility."""
    nodes = {}
    for part in (spec or "").split(","):
        if "=" in part:
            nid, prov = part.split("=", 1)
            nodes[nid.strip()] = prov.strip().split(":", 1)[0].strip()
    return nodes


def parse_edges(spec: str):
    edges = []
    for part in (spec or "").split(","):
        if ">" in part:
            s, d = part.split(">", 1)
            edges.append((s.strip(), d.strip()))
    return edges


def nodes_from_dsl(nodes_spec: str, edges_spec: str) -> list:
    """`id=provider[:kind]` pairs plus `a>b` edges -> Node list."""
    order, decl = [], {}
    for part in (nodes_spec or "").split(","):
        if "=" not in part:
            continue
        nid, rest = part.split("=", 1)
        nid = nid.strip()
        prov, _, kind = rest.strip().partition(":")
        decl[nid] = (prov.strip(), (kind.strip() or "work"))
        order.append(nid)
    deps: dict = {n: [] for n in order}
    for s, d in parse_edges(edges_spec):
        deps.setdefault(d, []).append(s)
        deps.setdefault(s, deps.get(s, []))
    out = []
    for nid in order:
        prov, kind = decl[nid]
        out.append(Node(id=nid, kind=kind, provider=prov, deps=list(deps.get(nid, []))))
    return out


def expand(nodes: list) -> list:
    """Expand `for_each` nodes into independent siblings — the fan-out
    primitive. Anything that depended on the parent id depends on every sibling
    (one failed unit comes back empty; it does not sink the batch)."""
    out, rename = [], {}
    for n in nodes:
        if n.kind in ("work", "verify") and n.for_each:
            sibs = []
            for i, item in enumerate(n.for_each):
                fields = dict(n.__dict__)
                for k in ("deps", "writes", "targets"):   # never share mutable state
                    fields[k] = list(fields.get(k) or [])
                s = Node(**fields)
                s.id = f"{n.id}#{i}"
                s.for_each = None
                s.item = str(item)
                s.label = n.label or n.id
                sibs.append(s)
                out.append(s)
            rename[n.id] = [s.id for s in sibs]
        else:
            out.append(n)
    if rename:
        for n in out:
            new_deps = []
            for d in n.deps:
                new_deps.extend(rename.get(d, [d]))
            n.deps = new_deps
            new_targets = []
            for t in n.targets:
                new_targets.extend(rename.get(t, [t]))
            n.targets = new_targets
    return out


def load_spec(spec) -> dict:
    """Accept a path, a JSON string, or an already-parsed dict."""
    if isinstance(spec, dict):
        data = spec
    else:
        text = str(spec)
        p = Path(text)
        if p.exists():
            text = p.read_text(encoding="utf-8")
        data = json.loads(text)
    nodes = [node_from_dict(d) for d in (data.get("nodes") or [])]
    # top-level edges are additive to per-node deps
    for e in data.get("edges") or []:
        if isinstance(e, dict):
            s, d = e.get("from"), e.get("to")
        else:
            s, d = (list(e) + [None, None])[:2]
        for n in nodes:
            if n.id == d and s and s not in n.deps:
                n.deps.append(s)
    budget = dict(DEFAULT_BUDGET)
    budget.update(data.get("budget") or {})
    repeat = dict(DEFAULT_REPEAT)
    repeat.update(data.get("repeat") or {})
    return {"name": data.get("name") or "graph", "nodes": expand(nodes),
            "budget": budget, "repeat": repeat}


# --------------------------------------------------------------------------
# lint — find the defects before you pay for them
# --------------------------------------------------------------------------

def _index(nodes: list) -> dict:
    return {n.id: n for n in nodes}


def find_cycles(nodes: list) -> list:
    """Return every dependency cycle as an id path. A cycle in a DAG engine is
    an error, not a hang: it is reported, and the run continues without it."""
    idx = _index(nodes)
    cycles, state, stack = [], {}, []

    def walk(nid):
        if state.get(nid) == "done":
            return
        if state.get(nid) == "open":
            if nid in stack:
                cycles.append(stack[stack.index(nid):] + [nid])
            return
        state[nid] = "open"
        stack.append(nid)
        for d in idx.get(nid, Node(id=nid)).deps:
            if d in idx:
                walk(d)
        stack.pop()
        state[nid] = "done"

    for n in nodes:
        walk(n.id)
    return cycles


def _reachable_deps(nodes: list) -> dict:
    """Transitive dependency closure per node (used for redundant-edge lint)."""
    idx = _index(nodes)
    memo: dict = {}

    def closure(nid, seen=None):
        if nid in memo:
            return memo[nid]
        seen = seen or set()
        if nid in seen:
            return set()
        seen = seen | {nid}
        acc = set()
        for d in idx.get(nid, Node(id=nid)).deps:
            if d in idx:
                acc.add(d)
                acc |= closure(d, seen)
        memo[nid] = acc
        return acc

    return {n.id: closure(n.id) for n in nodes}


def lint(nodes: list, budget: Optional[dict] = None, repeat: Optional[dict] = None) -> list:
    """Structural review of a topology. Returns [{level, node, code, msg}].

    `error` = the graph is malformed and that node will not run.
    `warn`  = it will run, but the shape is probably costing you something.
    """
    budget = {**DEFAULT_BUDGET, **(budget or {})}
    repeat = {**DEFAULT_REPEAT, **(repeat or {})}
    out, idx, seen_ids = [], _index(nodes), set()

    def err(nid, code, msg):
        out.append({"level": "error", "node": nid, "code": code, "msg": msg})

    def warn(nid, code, msg):
        out.append({"level": "warn", "node": nid, "code": code, "msg": msg})

    if not nodes:
        err("", "empty", "graph has no nodes")
        return out
    if len(nodes) > int(budget["max_nodes"]):
        err("", "node_cap",
            f"{len(nodes)} nodes exceeds max_nodes={budget['max_nodes']} — "
            "a hard cap on how many agents a graph may spawn")

    consumed: set = set()
    writers: dict = {}
    for n in nodes:
        if not n.id or not _ID_RE.match(n.id):
            err(n.id, "bad_id", f"invalid node id {n.id!r}")
        if n.id in seen_ids:
            err(n.id, "dup_id", f"duplicate node id {n.id!r}")
        seen_ids.add(n.id)
        if n.kind not in NODE_KINDS:
            err(n.id, "bad_kind", f"unknown kind {n.kind!r} (expected one of {', '.join(NODE_KINDS)})")
        if n.require not in ("any", "all"):
            err(n.id, "bad_require", f"require must be 'any' or 'all', got {n.require!r}")
        for d in n.deps:
            consumed.add(d)
            if d not in idx:
                err(n.id, "dangling_dep", f"depends on unknown node {d!r}")
        if n.kind in DISPATCHING_KINDS and not n.provider:
            err(n.id, "no_provider", f"{n.kind} node needs a provider (a node is one agent, one job)")
        if n.kind == "reduce":
            if n.op not in REDUCE_OPS:
                err(n.id, "bad_op", f"unknown reduce op {n.op!r} (expected {', '.join(REDUCE_OPS)})")
            if not n.deps:
                warn(n.id, "reduce_no_input", "reduce node has no inputs to reduce")
        if n.kind == "gate" and not n.cmd:
            err(n.id, "gate_no_cmd", "gate node needs a verification command")
        if n.kind == "route":
            unknown = [t for t in n.targets if t not in idx]
            if unknown:
                err(n.id, "bad_target", f"routes to unknown node(s): {', '.join(unknown)}")
            if len(n.targets) < 2:
                warn(n.id, "route_one_target",
                     "a router with fewer than 2 targets is not a decision — inline it")
        if n.kind == "verify":
            if n.threshold and n.threshold > max(1, n.voters):
                err(n.id, "bad_threshold",
                    f"threshold {n.threshold} exceeds voters {n.voters} — the verdict can never fire")
            if not n.deps:
                warn(n.id, "verify_no_input", "verify node has nothing to try to refute")
        if n.kind == "human" and not n.reason:
            warn(n.id, "human_no_reason",
                 "state what is expensive to undo here — a gate on everything makes the human the bottleneck")
        for w in n.writes:
            if w in writers and writers[w] != n.id:
                err(n.id, "two_writers",
                    f"both {writers[w]!r} and {n.id!r} write {w!r} — one writer per file")
            writers.setdefault(w, n.id)
        if n.require == "all" and len(n.deps) > 3:
            warn(n.id, "barrier",
                 f"barrier over {len(n.deps)} inputs: every downstream step waits for the slowest. "
                 "Keep it only if this stage genuinely needs the complete set (cross-set dedupe, "
                 "ranking, early exit)")

    for cyc in find_cycles(nodes):
        err(cyc[0], "cycle",
            "dependency cycle " + " -> ".join(cyc) + " — use the graph-level `repeat` block "
            "for loops (it is bounded and dedupes against everything seen)")

    # Fake and redundant edges: an arrow is real only when data crosses it.
    # Two edges are deliberately exempt, because data crossing is not what makes
    # them real:
    #   * a router -> target edge is CONTROL flow (the target is told it was
    #     chosen; it does not read the router's classification), and
    #   * reduce/gate/human nodes consume their deps structurally rather than
    #     through a prompt template.
    closure = _reachable_deps(nodes)
    control_edges: dict = {}
    for n in nodes:
        if n.kind == "route":
            for t in n.targets:
                control_edges.setdefault(t, set()).add(n.id)
    for n in nodes:
        if n.kind not in ("work", "verify", "route"):
            continue
        if not n.prompt or "{{inputs}}" in n.prompt:
            continue          # no template, or consumes every input wholesale
        for d in n.deps:
            if "{{%s}}" % d in n.prompt or d in control_edges.get(n.id, ()):
                continue
            others = [x for x in n.deps if x != d]
            if any(d in closure.get(o, set()) for o in others):
                warn(n.id, "redundant_edge",
                     f"edge {d} -> {n.id} carries no data AND is already implied "
                     "transitively — it is pure clutter, delete it")
            else:
                warn(n.id, "fake_edge",
                     f"{n.id} depends on {d} but never references it ({{{{{d}}}}} or {{{{inputs}}}}). "
                     "If it does not read that output, delete the edge and the two run in parallel")

    sinks = [n.id for n in nodes if n.id not in consumed]
    if not sinks:
        err("", "no_sink", "every node feeds another — the graph has no result node")
    if int(repeat.get("max_rounds", 1)) > 1 and not int(repeat.get("stop_after_dry_rounds", 0)):
        warn("", "loop_no_exit",
             "repeat.max_rounds > 1 without stop_after_dry_rounds — a loop with no dry "
             "condition spends its whole budget rediscovering the same ground")
    if int(repeat.get("max_rounds", 1)) > int(budget["max_rounds"]):
        err("", "round_cap",
            f"repeat.max_rounds={repeat['max_rounds']} exceeds budget max_rounds={budget['max_rounds']}")
    return out


# --------------------------------------------------------------------------
# plan — rehearse the topology before spending on it
# --------------------------------------------------------------------------

def plan(nodes: list, budget: Optional[dict] = None, repeat: Optional[dict] = None) -> dict:
    """Schedule + cost shape, with no dispatch. `levels` is the dataflow depth
    of each node (level 0 starts immediately); `critical_path` is how many
    sequential stages the run actually costs, which is the number that matters —
    not the node count."""
    budget = {**DEFAULT_BUDGET, **(budget or {})}
    repeat = {**DEFAULT_REPEAT, **(repeat or {})}
    idx = _index(nodes)
    levels: dict = {}

    def depth(nid, seen=None):
        if nid in levels:
            return levels[nid]
        seen = seen or set()
        if nid in seen or nid not in idx:
            return 0
        seen = seen | {nid}
        d = 0
        for dep in idx[nid].deps:
            if dep in idx:
                d = max(d, depth(dep, seen) + 1)
        levels[nid] = d
        return d

    for n in nodes:
        depth(n.id)

    rounds = max(1, int(repeat.get("max_rounds", 1)))
    per_round = sum(n.dispatches() for n in nodes)
    consumed = {d for n in nodes for d in n.deps}
    stages: dict = {}
    for n in nodes:
        stages.setdefault(levels.get(n.id, 0), []).append(n.id)
    widest = max((len(v) for v in stages.values()), default=0)
    return {
        "nodes": len(nodes),
        "levels": levels,
        "stages": {k: sorted(v) for k, v in sorted(stages.items())},
        "critical_path": (max(levels.values()) + 1) if levels else 0,
        "max_parallel": widest,
        "sinks": sorted(n.id for n in nodes if n.id not in consumed),
        "sources": sorted(n.id for n in nodes if not n.deps),
        "free_nodes": sorted(n.id for n in nodes if n.dispatches() == 0),
        "est_calls_per_round": per_round,
        "est_calls_total": per_round * rounds,
        "rounds": rounds,
        "budget": budget,
        "over_call_budget": per_round * rounds > int(budget["max_calls"]),
    }


# --------------------------------------------------------------------------
# node execution
# --------------------------------------------------------------------------

def _fmt_inputs(node: Node, outputs: dict, status: dict) -> str:
    """What a node sees from upstream — including, explicitly, who is absent.
    An absent input is stated, never quietly dropped, so the node cannot mistake
    silence for agreement."""
    chunks = []
    for d in node.deps:
        st = status.get(d, "absent")
        text = (outputs.get(d) or "").strip()
        if text:
            chunks.append(f"[{d}]\n{text}")
        else:
            chunks.append(f"[{d}] — ABSENT ({st}). No output was produced. "
                          "Do not treat this as agreement or as evidence.")
    return "\n\n".join(chunks)


def _render(node: Node, task: str, outputs: dict, status: dict,
            round_no: int, seen: Optional[set]) -> str:
    inputs = _fmt_inputs(node, outputs, status)
    body = node.prompt
    if not body:
        body = ("TASK:\n{{task}}\n\nYou are graph node '%s'." % node.id)
        if node.deps:
            body += "\n\nInputs from upstream nodes:\n{{inputs}}"
        body += ("\n\nProduce your output for the downstream nodes "
                 "(or the final answer if you are a sink).")
    out = body.replace("{{task}}", task).replace("{{inputs}}", inputs)
    out = out.replace("{{item}}", node.item or "").replace("{{node}}", node.id)
    out = out.replace("{{round}}", str(round_no))
    out = out.replace("{{seen}}", "\n".join(sorted(seen)) if seen else "(nothing yet)")
    for d in node.deps:
        out = out.replace("{{%s}}" % d, (outputs.get(d) or "").strip())
    return out


def _reduce(node: Node, outputs: dict) -> str:
    """Deterministic aggregation. No model call — flattening a list is a few
    lines of code, and an agent is the most expensive way to write them."""
    parts = [(d, (outputs.get(d) or "").strip()) for d in node.deps]
    parts = [(d, t) for d, t in parts if t]
    if node.op == "concat":
        return "\n\n".join(f"[{d}]\n{t}" for d, t in parts)
    if node.op == "list":
        return "\n".join(f"- [{d}] {t.splitlines()[0] if t.splitlines() else ''}" for d, t in parts)
    if node.op == "count":
        return str(len(parts))
    # dedupe: normalized line-level union, first spelling wins
    seen, keep = set(), []
    for _, t in parts:
        for line in t.splitlines():
            norm = normalize_item(line)
            if not norm or norm in seen:
                continue
            seen.add(norm)
            keep.append(line.strip())
    return "\n".join(keep)


def _verify(node: Node, task: str, prompt_ctx: str, timeout) -> dict:
    """Adversarial verification: N independent skeptics, each told to REFUTE and
    to default to refuted when uncertain. A finding that survives goes
    downstream; one that does not never reaches the report. Diverse lenses,
    because identical skeptics miss identical things."""
    voters = max(1, int(node.voters or 1))
    explicit = int(node.threshold or 0)

    def one(i):
        lens = VERIFY_LENSES[i % len(VERIFY_LENSES)]
        p = (f"TASK UNDER REVIEW:\n{task}\n\n"
             f"CLAIM(S) TO REFUTE:\n{prompt_ctx}\n\n"
             f"Your lens: {lens}\n"
             "Try to REFUTE the claim(s). You are not here to agree. If you are uncertain, "
             "default to refuted. Answer with:\nVERDICT: refuted|survives\nREASON: <one paragraph "
             "naming the specific flaw, or the specific evidence that made it survive>")
        return dispatch(node.provider, p, model=node.model, effort=node.effort, timeout=timeout)

    replies = []
    with ThreadPoolExecutor(max_workers=voters) as ex:
        for f in as_completed([ex.submit(one, i) for i in range(voters)]):
            replies.append(f.result())
    returned = [r for r in replies if r.ok and r.text.strip()]
    refuted = sum(1 for r in returned
                  if re.search(r"^\s*VERDICT:\s*refuted", r.text, re.I | re.M))
    # Without an explicit threshold, a majority is computed over the skeptics
    # that ACTUALLY VOTED. Holding a degraded panel to the full-panel majority
    # would let a finding "survive" scrutiny it never received — absent skeptics
    # are not endorsements, and the safe direction under thin evidence is more
    # skeptical, not less.
    threshold = explicit or (len(returned) // 2 + 1 if returned else 1)
    verdict = "refuted" if refuted >= threshold else ("survives" if returned else "unverified")
    body = "\n\n".join(f"[skeptic {i + 1}]\n{r.text.strip()}" for i, r in enumerate(returned))
    sample = "" if len(returned) == voters else \
        f" — DEGRADED PANEL: {voters - len(returned)} of {voters} skeptics absent"
    return {
        "verdict": verdict, "refuted": refuted, "threshold": threshold,
        "voters": voters, "returned": len(returned),
        "text": (f"VERDICT: {verdict} ({refuted}/{len(returned)} refuted, "
                 f"threshold {threshold}){sample}\n\n{body}"),
    }


def _route(node: Node, task: str, prompt: str, timeout) -> dict:
    """Classify, then fire exactly one edge. The classification is the model's;
    the routing is ordinary code, so the same input takes the same path every
    time — no surprise decisions buried inside a model's head."""
    opts = "\n".join(f"- {t}" for t in node.targets)
    p = (prompt + "\n\nChoose exactly ONE next node from this list:\n" + opts +
         "\n\nAnswer with a single line: 'ROUTE: <node_id>' followed by one sentence of reasoning.")
    r = dispatch(node.provider, p, model=node.model, effort=node.effort, timeout=timeout)
    chosen = ""
    if r.ok and r.text:
        m = re.search(r"^\s*ROUTE:\s*([A-Za-z0-9_.#-]+)", r.text, re.I | re.M)
        if m and m.group(1) in node.targets:
            chosen = m.group(1)
        if not chosen:
            # Fall back to a named target only when EXACTLY ONE is named. "this
            # is not a quick change, run the audit" names both; picking the
            # first is precisely the surprise decision buried in a model's head
            # that routing-in-code exists to prevent. Ambiguous -> no route.
            named = [t for t in node.targets
                     if re.search(rf"(?<!\w){re.escape(t)}(?!\w)", r.text)]
            if len(named) == 1:
                chosen = named[0]
    return {"chosen": chosen, "reply": r, "status": r.status}


# --------------------------------------------------------------------------
# novelty tracking for loop-until-dry
# --------------------------------------------------------------------------

def normalize_item(line: str) -> str:
    """Normalize one finding for dedup. Rounds compare against EVERYTHING ever
    seen — dedup against only the confirmed set makes rejected results reappear
    every round and the loop never goes dry."""
    s = re.sub(r"^[\s\-\*•\d.)#]+", "", (line or "").strip())
    s = re.sub(r"[^a-z0-9 ]+", " ", s.lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) >= 8 else ""


def novel_items(text: str, seen: set) -> list:
    fresh = []
    for line in (text or "").splitlines():
        k = normalize_item(line)
        if k and k not in seen:
            seen.add(k)
            fresh.append(line.strip())
    return fresh


# --------------------------------------------------------------------------
# the scheduler
# --------------------------------------------------------------------------

def _approved_set(approve) -> set:
    if approve is None:
        approve = os.environ.get("FUSION_GRAPH_APPROVED", "")
    if isinstance(approve, str):
        return {x.strip() for x in approve.split(",") if x.strip()}
    return set(approve or [])


def _run_once(nodes: list, task: str, budget: dict, round_no: int,
              seen: Optional[set], approved: set, timeout, max_workers: int) -> dict:
    """One dataflow pass. A node fires the moment its own dependencies resolve —
    there is no wave barrier, so item A can be three stages ahead of item B."""
    idx = _index(nodes)
    outputs: dict = {}
    status: dict = {}
    detail: dict = {}
    transcript: list = []
    pending = {n.id for n in nodes if n.id in idx}
    resolved: set = set()
    calls = 0
    call_cap = int(budget.get("max_calls") or DEFAULT_BUDGET["max_calls"])
    not_taken: set = set()

    def upstream_ok(n: Node) -> bool:
        if not n.deps:
            return True
        have = [d for d in n.deps if (outputs.get(d) or "").strip()]
        if n.require == "all":
            return len(have) == len([d for d in n.deps if d in idx])
        return bool(have)

    def blocked_by(n: Node) -> str:
        for d in n.deps:
            if d in not_taken or status.get(d) in ("skipped", "blocked", "awaiting_approval"):
                return d
        return ""

    def run_node(nid: str) -> dict:
        n = idx[nid]
        rec = {"node": nid, "kind": n.kind, "provider": n.provider or None,
               "deps": list(n.deps), "label": n.label or None, "item": n.item or None}

        if nid in not_taken:      # a router fired a different edge
            rec.update(status="skipped", text="", note="branch not taken by router")
            return rec
        b = blocked_by(n)
        if b:
            rec.update(status="skipped", text="", note=f"upstream {b} did not fire")
            return rec
        if not upstream_ok(n):
            rec.update(status="skipped", text="",
                       note=("barrier unsatisfied — some inputs absent"
                             if n.require == "all" else "all inputs absent"))
            return rec

        if n.kind == "reduce":
            rec.update(status="returned", text=_reduce(n, outputs), op=n.op, cost=0)
            return rec

        if n.kind == "gate":
            g = run_gate(n.cmd, cwd=(n.cwd or None))
            rec.update(status=("returned" if g.get("passed") else "error"),
                       text=(g.get("log") or ""), gate=g, cost=0)
            return rec

        if n.kind == "human":
            if nid in approved or (n.label and n.label in approved):
                rec.update(status="returned", text=f"approved: {n.reason or nid}", cost=0)
            else:
                rec.update(status="awaiting_approval", text="", reason=n.reason, cost=0)
            return rec

        prompt = _render(n, task, outputs, status, round_no, seen)
        if n.kind == "verify":
            v = _verify(n, task, prompt, timeout)
            rec.update(status=("returned" if v["returned"] else "absent"),
                       text=v["text"], verdict=v["verdict"], refuted=v["refuted"],
                       voters=v["voters"], returned_voters=v["returned"],
                       threshold=v["threshold"])
            return rec
        if n.kind == "route":
            r = _route(n, task, prompt, timeout)
            rec.update(status=r["reply"].status, text=r["reply"].text,
                       chosen=r["chosen"] or None)
            return rec

        r = dispatch(n.provider, prompt, model=n.model, effort=n.effort, timeout=timeout)
        rec.update(status=r.status, text=r.text)
        return rec

    with ThreadPoolExecutor(max_workers=max(1, max_workers)) as ex:
        running: dict = {}
        while pending or running:
            ready = sorted(n for n in pending
                           if all((d not in idx) or (d in resolved) for d in idx[n].deps))
            for nid in ready:
                pending.discard(nid)
                cost = idx[nid].dispatches()
                if cost and calls + cost > call_cap:   # hard cap, checked before spending
                    status[nid] = "blocked"
                    outputs[nid] = ""
                    resolved.add(nid)
                    transcript.append({"node": nid, "kind": idx[nid].kind, "status": "blocked",
                                       "deps": list(idx[nid].deps), "text": "",
                                       "note": f"call budget {call_cap} would be exceeded"})
                    continue
                calls += cost
                running[ex.submit(run_node, nid)] = nid
            if not running:
                if ready:          # progress was made (budget-blocked nodes resolved)
                    continue
                for nid in sorted(pending):     # unreachable (cycle) — reported, not hung
                    status[nid] = "blocked"
                    transcript.append({"node": nid, "kind": idx[nid].kind, "status": "blocked",
                                       "deps": list(idx[nid].deps), "text": "",
                                       "note": "unreachable — cyclic or blocked dependency"})
                pending.clear()
                break
            fut = next(as_completed(list(running)))
            nid = running.pop(fut)
            try:
                rec = fut.result()
            except Exception as e:  # a failed unit comes back empty, never crashes the batch
                rec = {"node": nid, "kind": idx[nid].kind, "status": "error",
                       "deps": list(idx[nid].deps), "text": "", "note": str(e)}
            transcript.append(rec)
            outputs[nid] = rec.get("text") or ""
            status[nid] = rec.get("status") or "error"
            detail[nid] = rec
            resolved.add(nid)
            if idx[nid].kind == "route":
                chosen = rec.get("chosen")
                for t in idx[nid].targets:
                    if t != chosen:
                        not_taken.add(t)

    consumed = {d for n in nodes for d in n.deps}
    sinks = [n.id for n in nodes if n.id not in consumed]
    return {
        "round": round_no,
        "transcript": transcript,
        "outputs": outputs,
        "status": status,
        "detail": detail,
        "sinks": sinks,
        "final": {n: outputs.get(n, "") for n in sinks},
        "calls": calls,
        "absent": sorted(n for n, s in status.items() if s not in ("returned",)),
        "needs_approval": sorted(n for n, s in status.items() if s == "awaiting_approval"),
    }


def run(task, nodes=None, edges=None, spec=None, timeout=None, approve=None,
        max_workers=8, nodes_spec=None, edges_spec=None, dry_run=False):
    """Run a graph. Give it either a `spec` (JSON path/string/dict) or the
    compact `nodes`/`edges` DSL. `dry_run=True` lints and plans without
    dispatching anything — always the cheapest place to find a bad topology."""
    nodes = nodes if nodes is not None else nodes_spec
    edges = edges if edges is not None else edges_spec

    if spec:
        s = load_spec(spec)
        node_list, budget, repeat, name = s["nodes"], s["budget"], s["repeat"], s["name"]
    else:
        node_list = expand(nodes_from_dsl(nodes or "", edges or ""))
        budget, repeat, name = dict(DEFAULT_BUDGET), dict(DEFAULT_REPEAT), "graph"

    if timeout is not None:
        budget["node_timeout"] = timeout
    node_timeout = budget.get("node_timeout")

    issues = lint(node_list, budget, repeat)
    errors = [i for i in issues if i["level"] == "error"]
    the_plan = plan(node_list, budget, repeat)
    base = {
        "pattern": "graph", "name": name, "task": task,
        "nodes": {n.id: (n.provider or n.kind) for n in node_list},
        "kinds": {n.id: n.kind for n in node_list},
        "edges": [(d, n.id) for n in node_list for d in n.deps],
        "lint": issues, "plan": the_plan, "budget": budget, "repeat": repeat,
    }

    if dry_run or errors:
        base.update(dry_run=True, ran=False, transcript=[], final={},
                    blocked_by_lint=bool(errors))
        return base
    if the_plan["over_call_budget"]:
        base.update(dry_run=True, ran=False, transcript=[], final={}, blocked_by_lint=True,
                    lint=issues + [{"level": "error", "node": "", "code": "call_cap",
                                    "msg": f"estimated {the_plan['est_calls_total']} calls exceeds "
                                           f"max_calls={budget['max_calls']}"}])
        return base

    approved = _approved_set(approve)
    max_rounds = min(int(repeat.get("max_rounds", 1)), int(budget.get("max_rounds", 1)))
    dry_needed = int(repeat.get("stop_after_dry_rounds", 0) or 0)

    seen: set = set()
    rounds, transcript, dry_streak, total_calls = [], [], 0, 0
    last = {}
    for r in range(1, max(1, max_rounds) + 1):
        last = _run_once(node_list, task, budget, r, seen if max_rounds > 1 else None,
                         approved, node_timeout, max_workers)
        total_calls += last["calls"]
        transcript.extend(last["transcript"])
        fresh = []
        if max_rounds > 1:
            for sink in last["sinks"]:
                fresh.extend(novel_items(last["outputs"].get(sink, ""), seen))
            dry_streak = dry_streak + 1 if not fresh else 0
        rounds.append({"round": r, "new_items": len(fresh),
                       "calls": last["calls"], "absent": last["absent"]})
        if last["needs_approval"]:
            break
        if dry_needed and dry_streak >= dry_needed:
            break
        budget = {**budget, "max_calls": int(budget["max_calls"]) - last["calls"]}
        if budget["max_calls"] <= 0:
            break

    base.update(
        ran=True, dry_run=False, rounds=rounds, rounds_run=len(rounds),
        transcript=transcript, status=last.get("status", {}),
        sinks=last.get("sinks", []), final=last.get("final", {}),
        absent=last.get("absent", []), needs_approval=last.get("needs_approval", []),
        calls=total_calls, seen_items=len(seen),
    )
    return base
