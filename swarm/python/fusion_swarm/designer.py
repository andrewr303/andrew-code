"""Swarm designer — named topology catalog + fail-closed SwarmSpec.

The architect (Fable 5.1 and/or Astra) is given this catalog and a
``design_prompt`` that *also* grants latitude to invent a custom swarm when
none of the named forms fit. User-pinned providers/models are hard
constraints; everything else is the architect's call.

Stdlib only. Validation fails closed: unknown SwarmSpec fields, unknown
providers, over-spawn, and ``cross_talk`` without a board are errors, never
silently coerced. No live CLI calls live here — this module only shapes
JSON the hive runner will later execute.
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field, fields
from typing import Any


# --- enumerations (fail-closed value sets) ----------------------------------

TOPOLOGY_COMMUNICATION = ("blind", "board", "lineage", "open")
SPEC_COMMUNICATION = ("open", "lineage", "need-to-know")
CAPTAIN_FIELDS = ("id", "provider", "model", "spawn", "spawn_via")
SEAT_FIELDS = ("provider", "model")

# Defaults match SpawnLimits in identities.py (that module is a sibling slice).
DEFAULT_MAX_DEPTH = 2
DEFAULT_MAX_CHILDREN = 4
DEFAULT_MAX_AGENTS = 24

# Canonical nested-hive: 4 captains; muse and glm each spawn 4 andrewcode
# children; open board; architect talks to everyone.
NESTED_HIVE_EXAMPLE: dict[str, Any] = {
    "name": "nested-hive",
    "architect": {"provider": "fable", "model": "fable-5.1"},
    "operator": {"provider": "codex", "model": "gpt-6-astra"},
    "captains": [
        {
            "id": "muse",
            "provider": "andrewcode",
            "model": "muse-spark-1.3",
            "spawn": 4,
            "spawn_via": "andrewcode",
        },
        {
            "id": "glm",
            "provider": "opencode",
            "model": "glm-5.3",
            "spawn": 4,
            "spawn_via": "andrewcode",
        },
        {
            "id": "grok",
            "provider": "grok",
            "model": "grok-4.5",
            "spawn": 0,
            "spawn_via": "adapter",
        },
        {
            "id": "copilot",
            "provider": "copilot",
            "model": "gemini-3.5-flash",
            "spawn": 0,
            "spawn_via": "adapter",
        },
    ],
    "cross_talk": True,
    "board": True,
    "max_depth": DEFAULT_MAX_DEPTH,
    "max_children_per_agent": DEFAULT_MAX_CHILDREN,
    "max_agents": DEFAULT_MAX_AGENTS,
    "budget": {},
    "communication": "open",
    "task": "",
    "notes": (
        "Architect talks to everyone. Captains talk to their children. "
        "Children of different captains can talk on the open Hive Board."
    ),
}


class DesignerError(ValueError):
    """Raised when a SwarmSpec fails schema parsing. ``errors`` lists every
    problem found so a repair prompt can address them together."""

    def __init__(self, kind: str, errors: list[str]):
        self.kind = kind
        self.errors = errors
        super().__init__(f"{kind}: " + "; ".join(errors))


def _err(errors: list[str], cond: bool, msg: str) -> None:
    if not cond:
        errors.append(msg)


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _is_nonempty_str(v: Any) -> bool:
    return isinstance(v, str) and v.strip() != ""


# --- Topology catalog -------------------------------------------------------

@dataclass(frozen=True)
class Topology:
    """A named swarm form the architect may pick or deviate from."""

    name: str
    when: str
    mechanic: str
    communication: str  # blind | board | lineage | open
    nesting: bool
    default_captains: int
    default_children: int
    cost_shape: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _t(
    name: str,
    when: str,
    mechanic: str,
    communication: str,
    nesting: bool,
    default_captains: int,
    default_children: int,
    cost_shape: str,
) -> Topology:
    if communication not in TOPOLOGY_COMMUNICATION:
        raise ValueError(f"topology {name!r}: communication must be one of {TOPOLOGY_COMMUNICATION}")
    return Topology(
        name=name,
        when=when,
        mechanic=mechanic,
        communication=communication,
        nesting=nesting,
        default_captains=default_captains,
        default_children=default_children,
        cost_shape=cost_shape,
    )


# Order is the required catalog. Names MUST stay unique.
_TOPOLOGY_LIST: tuple[Topology, ...] = (
    _t(
        "solo",
        "Trivial, saturated, or already certain; panel cost exceeds the cost of being wrong. "
        "Also the honest fallback when fewer than two captains are live.",
        "Architect (or one captain) answers alone. Label the run solo. Do not dress a solo "
        "answer up as a council. Record it with no invented panelists.",
        "open", False, 0, 0, "1x",
    ),
    _t(
        "panel",
        "Open-ended research, 'how should I…', or a code task with one clear deliverable. "
        "Default for most fusion-worthy tasks.",
        "Blind parallel fan-out of captains on the same prompt; host/architect synthesizes. "
        "Non-returning captains are absent — absent is not agreement.",
        "blind", False, 4, 0, "N panel + 1 synthesis (~2–5x)",
    ),
    _t(
        "council",
        "High-stakes open decision where disagreement must be surfaced and pressure-tested, "
        "not averaged away.",
        "Three rounds: (1) blind independent analysis, (2) anonymized cross-examination, "
        "(3) crystallize. Architect chairs the verdict. Suspiciously high agreement forces "
        "a counterfactual before commit.",
        "blind", False, 4, 0, "~3x panel + synthesis",
    ),
    _t(
        "debate",
        "Contested either/or (A vs B, ship vs wait) where the tension is the signal.",
        "Two captains of distinct families take opposing stances for 1–3 rounds, each "
        "revising after the other's last argument. Architect adjudicates with kill criteria; "
        "do not split the difference for politeness.",
        "open", False, 2, 0, "2 captains x K rounds + adjudication",
    ),
    _t(
        "vote",
        "The answer is a single checkable value — a number, yes/no, one option, a short fact. "
        "Synthesis would only blur it.",
        "Blind panel; extract each returning captain's answer key; majority wins; tie-break "
        "by panel order. Split votes escalate to panel synthesis. No judge call on a clean majority.",
        "blind", False, 4, 0, "N panel, no judge call",
    ),
    _t(
        "swarm",
        "Large or parallelizable build/research — many files or independent sub-questions — "
        "where having everyone answer the whole thing is wasteful.",
        "Architect decomposes into independent subtasks with dependencies, routes each to a "
        "suited captain, executes in dependency waves, synthesizes, then runs/verifies end to end.",
        "lineage", False, 4, 0, "~1 call per subtask + synthesis",
    ),
    _t(
        "hierarchy",
        "Work that needs a director to split a large objective across specialists who should "
        "not share the director's full context.",
        "Director/captain decomposes and assigns; workers receive only the task plus injected "
        "context; results return as structured callbacks. Context isolation is the point.",
        "lineage", True, 1, 4, "1 director + N workers",
    ),
    _t(
        "metaloop",
        "Long-running, gated implementation where an advisor (Fable) and an operator (Codex/"
        "Astra) must stay in the loop around tiered labor.",
        "Asymmetric roster: advisor consults, operator plans/adjudicates/integrates, expert "
        "and fast workers execute in dependency waves behind deterministic gates. Escalation "
        "is bounded (retry → alternate → promote → takeover → advisor → stop).",
        "lineage", True, 3, 2, "advisor + operator + tiered waves + gates",
    ),
    _t(
        "moa",
        "Hard open-ended work that benefits from layered refinement rather than one-shot panel.",
        "Each layer, every captain answers seeing the previous layer's answers (not same-layer "
        "peers). Final aggregation. Panel is MoA with one layer.",
        "blind", False, 4, 0, "layers x N + aggregator",
    ),
    _t(
        "heavy",
        "Research-grade, high-stakes analysis that wants role specialization rather than the "
        "same prompt to everyone.",
        "Decompose into Research / Analysis / Alternatives / Verification; each role answered "
        "in parallel; synthesize; optional refinement loops on prior findings.",
        "blind", False, 4, 0, "4 roles x loops + synthesis",
    ),
    _t(
        "discuss",
        "Collaborative brainstorm where ideas should compound rather than stay blind.",
        "Shared multi-round discussion: each round captains see the running transcript and add "
        "one focused contribution, then a synthesis. Within a round they are parallel.",
        "open", False, 4, 0, "rounds x N + synthesis",
    ),
    _t(
        "graph",
        "The *shape* of the work is the problem: fan-out over N files, pipelines with suspected "
        "false sequencing, routing by classification, loop-until-dry discovery.",
        "Explicit DAG of typed nodes (work / verify / route / reduce / gate / human). Lint and "
        "plan before spend. Absent nodes are stated downstream — they never read as agreement.",
        "lineage", False, 4, 0, "exactly what --plan estimates",
    ),
    _t(
        "ladder",
        "Routine work that should try the cheapest capable tier first and only pay flagship "
        "rates on genuine failure.",
        "cheap → mid → strong. A GATE failure (or low confidence) escalates to the next tier "
        "with the failure log attached. Stop at the first tier that passes.",
        "lineage", False, 3, 0, "1..K tiers (stops early on pass)",
    ),
    _t(
        "speclock",
        "Multi-module coding where integration, not generation, is the hard part.",
        "Write a hard interface contract first (types + signatures + failing stubs), then fan "
        "out modules in parallel against that contract. A build/typecheck GATE is the integrator.",
        "lineage", False, 1, 3, "1 contract + N modules + gate",
    ),
    _t(
        "breaker",
        "Need robust code, not code two models agreed looked fine.",
        "Builder produces a solution; breaker must produce executable counterexamples. With a "
        "gate_cmd the gate is the arbiter; without one the builder hardens each round. Ends when "
        "the breaker cannot break it or the round budget is spent.",
        "open", False, 2, 0, "2 captains x K rounds + gates",
    ),
    _t(
        "ballot",
        "Need a winner among proposals without self-vote or first-speaker anchoring.",
        "Blind proposals, anonymized before voting; each voter casts up to 2 approval votes "
        "and cannot vote for itself. Ties broken by a verification GATE, not another opinion.",
        "blind", False, 4, 0, "N proposals + N ballots + optional gate",
    ),
    _t(
        "factory",
        "Repeated artifact production against a shared spec (many similar modules, migrations, "
        "or generated files) where a foreman should mint workers rather than pre-declare them.",
        "A captain-foreman holds the contract and spawns specialized andrewcode children, each "
        "producing one class of artifact. Children report to the foreman; the architect sees "
        "the factory channel. Nesting is the point.",
        "lineage", True, 1, 4, "1 foreman + N spawned workers",
    ),
    _t(
        "diamond",
        "Work that should fan out to specialists then fan in to one synthesizer (the diamond DAG).",
        "Architect (apex) splits into parallel specialist captains; their outputs converge on "
        "a single merge/synth node. No cross-talk on the fan-out edge; open at the merge.",
        "lineage", False, 4, 0, "1 split + N parallel + 1 merge",
    ),
    _t(
        "nested-hive",
        "A nested coding swarm: several live-CLI captains, some of which spawn andrewcode "
        "children, all talking on one Hive Board. Use when captains need workers and those "
        "workers must be able to talk across lineages.",
        "Register architect + operator + captains on the Hive Board. Captains that declare "
        "spawn>0 mint that many andrewcode children (even if the captain itself is "
        "opencode/glm/grok/copilot). Lineage channels plus hive/architect/captains/workers. "
        "Canonical example: 4 captains; muse-spark-1.3 and glm-5.3 each spawn 4 andrewcode "
        "children; open board; architect talks to all; children of different captains can talk.",
        "board", True, 4, 4, "1 architect + 1 operator + C captains + sum(spawn) children",
    ),
    _t(
        "ultraswarm",
        "User asks for UltraSwarm, or a large coding/research task needs explicit model "
        "selection and council-before-execution.",
        "Select models, convene a council on framing/risks/division of labor, assign concrete "
        "tasks (including the architect's own), dispatch, then integrate and run checks that "
        "can fail. Heavier than plain swarm.",
        "board", True, 4, 0, "selector + council + worker calls + integration",
    ),
    _t(
        "ureview",
        "The user wants the thing built right the first time — a feature, refactor, or "
        "migration where a wrong early decision is expensive to unwind.",
        "Plan-audit → build → review. One reviewer audits the architect's plan before code "
        "exists and the implementation after it does. The panel does not produce candidate "
        "answers; it audits.",
        "lineage", False, 2, 0, "plan audit + build + implementation review",
    ),
    _t(
        "custom",
        "None of the named forms fit. The architect invents a topology whose mechanic, "
        "nesting, and communication match the task.",
        "Invent roles, spawn graph, and board policy. Still emit a valid SwarmSpec. Honor "
        "user-pinned providers/models. Nested processes are andrewcode; captains may be any "
        "live CLI. Do not invent providers that are not on the live roster.",
        "board", True, 0, 0, "whatever the invented graph costs — state it in notes",
    ),
)


TOPOLOGIES: dict[str, Topology] = {t.name: t for t in _TOPOLOGY_LIST}
CATALOG_NAMES: tuple[str, ...] = tuple(t.name for t in _TOPOLOGY_LIST)


def catalog() -> list[Topology]:
    """Named forms, in catalog order."""
    return list(_TOPOLOGY_LIST)


def get_topology(name: str) -> Topology | None:
    return TOPOLOGIES.get(name)


# --- SwarmSpec --------------------------------------------------------------

@dataclass
class AgentSeat:
    """Architect or operator seat: a live CLI provider + model."""

    provider: str
    model: str = ""

    def to_dict(self) -> dict[str, str]:
        return {"provider": self.provider, "model": self.model}

    @classmethod
    def from_dict(cls, d: Any, label: str) -> "AgentSeat":
        if not isinstance(d, dict):
            raise DesignerError("SwarmSpec", [f"{label} must be an object with provider and model"])
        unknown = set(d) - set(SEAT_FIELDS)
        if unknown:
            raise DesignerError("SwarmSpec", [f"{label} unknown field(s): {sorted(unknown)}"])
        provider = d.get("provider", "")
        model = d.get("model", "")
        if not isinstance(provider, str) or not isinstance(model, str):
            raise DesignerError("SwarmSpec", [f"{label} provider and model must be strings"])
        return cls(provider=provider, model=model)


@dataclass
class CaptainSpec:
    """One captain in the swarm. ``spawn`` is how many andrewcode children it mints."""

    id: str
    provider: str
    model: str
    spawn: int = 0
    spawn_via: str = "andrewcode"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Any, index: int) -> "CaptainSpec":
        label = f"captains[{index}]"
        if not isinstance(d, dict):
            raise DesignerError("SwarmSpec", [f"{label} must be an object"])
        unknown = set(d) - set(CAPTAIN_FIELDS)
        if unknown:
            raise DesignerError("SwarmSpec", [f"{label} unknown field(s): {sorted(unknown)}"])
        spawn = d.get("spawn", 0)
        if not _is_int(spawn):
            raise DesignerError("SwarmSpec", [f"{label}.spawn must be an integer"])
        ident = d.get("id", "")
        provider = d.get("provider", "")
        model = d.get("model", "")
        spawn_via = d.get("spawn_via", "andrewcode")
        for fld, val in (("id", ident), ("provider", provider), ("model", model), ("spawn_via", spawn_via)):
            if not isinstance(val, str):
                raise DesignerError("SwarmSpec", [f"{label}.{fld} must be a string"])
        return cls(
            id=ident,
            provider=provider,
            model=model,
            spawn=spawn,
            spawn_via=spawn_via,
        )


@dataclass
class SwarmSpec:
    """Fail-closed swarm design the hive runner executes.

    Unknown fields are rejected. Semantic checks (roster, spawn budget,
    board vs cross_talk) live in ``validate_spec``.
    """

    name: str
    architect: AgentSeat | None = None
    operator: AgentSeat | None = None
    captains: list[CaptainSpec] = field(default_factory=list)
    cross_talk: bool = False
    board: bool = False
    max_depth: int = DEFAULT_MAX_DEPTH
    max_children_per_agent: int = DEFAULT_MAX_CHILDREN
    max_agents: int = DEFAULT_MAX_AGENTS
    budget: dict[str, Any] = field(default_factory=dict)
    communication: str = "open"  # open | lineage | need-to-know
    task: str = ""
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "architect": None if self.architect is None else self.architect.to_dict(),
            "operator": None if self.operator is None else self.operator.to_dict(),
            "captains": [c.to_dict() for c in self.captains],
            "cross_talk": self.cross_talk,
            "board": self.board,
            "max_depth": self.max_depth,
            "max_children_per_agent": self.max_children_per_agent,
            "max_agents": self.max_agents,
            "budget": dict(self.budget),
            "communication": self.communication,
            "task": self.task,
            "notes": self.notes,
        }

    @classmethod
    def from_dict(cls, d: Any) -> "SwarmSpec":
        if not isinstance(d, dict):
            raise DesignerError("SwarmSpec", ["input is not an object"])
        known = {f.name for f in fields(cls)}
        unknown = set(d) - known
        if unknown:
            raise DesignerError("SwarmSpec", [f"unknown field(s): {sorted(unknown)}"])

        errors: list[str] = []
        name = d.get("name", "")
        if not isinstance(name, str):
            errors.append("name must be a string")
            name = ""

        architect = None
        if "architect" in d and d["architect"] is not None:
            try:
                architect = AgentSeat.from_dict(d["architect"], "architect")
            except DesignerError as exc:
                errors.extend(exc.errors)

        operator = None
        if "operator" in d and d["operator"] is not None:
            try:
                operator = AgentSeat.from_dict(d["operator"], "operator")
            except DesignerError as exc:
                errors.extend(exc.errors)

        captains_raw = d.get("captains", [])
        captains: list[CaptainSpec] = []
        if "captains" in d and not isinstance(captains_raw, list):
            errors.append("captains must be a list")
        elif isinstance(captains_raw, list):
            for i, item in enumerate(captains_raw):
                try:
                    captains.append(CaptainSpec.from_dict(item, i))
                except DesignerError as exc:
                    errors.extend(exc.errors)

        def _bool(key: str, default: bool) -> bool:
            if key not in d:
                return default
            val = d[key]
            if not isinstance(val, bool):
                errors.append(f"{key} must be a boolean")
                return default
            return val

        def _int(key: str, default: int) -> int:
            if key not in d:
                return default
            val = d[key]
            if not _is_int(val):
                errors.append(f"{key} must be an integer")
                return default
            return val

        cross_talk = _bool("cross_talk", False)
        board = _bool("board", False)
        max_depth = _int("max_depth", DEFAULT_MAX_DEPTH)
        max_children = _int("max_children_per_agent", DEFAULT_MAX_CHILDREN)
        max_agents = _int("max_agents", DEFAULT_MAX_AGENTS)

        budget = d.get("budget", {})
        if "budget" in d and not isinstance(budget, dict):
            errors.append("budget must be an object")
            budget = {}
        elif not isinstance(budget, dict):
            budget = {}

        communication = d.get("communication", "open")
        if not isinstance(communication, str):
            errors.append("communication must be a string")
            communication = "open"

        task = d.get("task", "")
        notes = d.get("notes", "")
        if "task" in d and not isinstance(task, str):
            errors.append("task must be a string")
            task = ""
        if "notes" in d and not isinstance(notes, str):
            errors.append("notes must be a string")
            notes = ""

        if errors:
            raise DesignerError("SwarmSpec", errors)

        return cls(
            name=name,
            architect=architect,
            operator=operator,
            captains=captains,
            cross_talk=cross_talk,
            board=board,
            max_depth=max_depth,
            max_children_per_agent=max_children,
            max_agents=max_agents,
            budget=dict(budget),
            communication=communication,
            task=task,
            notes=notes,
        )


# --- JSON extraction --------------------------------------------------------

_FENCE_RE = re.compile(
    r"```(?:json|JSON)?\s*\r?\n(.*?)```",
    re.DOTALL,
)


def _extract_json_object(text: str) -> dict[str, Any]:
    if not isinstance(text, str) or not text.strip():
        raise DesignerError("SwarmSpec", ["input is empty"])
    stripped = text.strip()

    candidates: list[str] = []
    for m in _FENCE_RE.finditer(stripped):
        candidates.append(m.group(1).strip())
    candidates.append(stripped)

    last_err = "no JSON object found"
    for cand in candidates:
        blob = cand
        if not blob.startswith("{"):
            start = blob.find("{")
            end = blob.rfind("}")
            if start < 0 or end <= start:
                continue
            blob = blob[start : end + 1]
        try:
            obj = json.loads(blob)
        except json.JSONDecodeError as exc:
            last_err = f"JSON parse error: {exc}"
            continue
        if isinstance(obj, dict):
            return obj
        last_err = "JSON root must be an object"
    raise DesignerError("SwarmSpec", [last_err])


def parse_swarm_spec(text: str) -> SwarmSpec:
    """Extract SwarmSpec JSON from free text (markdown fences tolerated)."""
    return SwarmSpec.from_dict(_extract_json_object(text))


# --- live roster ------------------------------------------------------------

def _roster_providers(live_roster: Any) -> set[str]:
    """Normalize a live roster to a set of provider names.

    Accepts a list of strings, a list of dicts with a ``provider`` (or
    ``name``/``id``) key, or a dict keyed by provider.
    """
    if live_roster is None:
        return set()
    if isinstance(live_roster, dict):
        return {str(k) for k in live_roster.keys()}
    if isinstance(live_roster, (list, tuple, set)):
        out: set[str] = set()
        for item in live_roster:
            if isinstance(item, str) and item.strip():
                out.add(item.strip())
            elif isinstance(item, dict):
                p = item.get("provider") or item.get("name") or item.get("id")
                if isinstance(p, str) and p.strip():
                    out.add(p.strip())
        return out
    return set()


def _seats_to_check(spec: SwarmSpec) -> list[tuple[str, str]]:
    """(label, provider) pairs that must exist on the live roster."""
    out: list[tuple[str, str]] = []
    if spec.architect is not None:
        out.append(("architect", spec.architect.provider))
    if spec.operator is not None:
        out.append(("operator", spec.operator.provider))
    for i, cap in enumerate(spec.captains):
        out.append((f"captains[{i}].provider ({cap.id or cap.provider})", cap.provider))
    return out


# --- validate ---------------------------------------------------------------

def validate_spec(spec: SwarmSpec, live_roster: Any) -> list[str]:
    """Fail-closed semantic checks. Returns every error found (empty = valid).

    Errors include: missing architect, spawn > max_children_per_agent,
    ``cross_talk`` with ``board=false``, unknown provider not in
    ``live_roster`` (unknown provider is an error, not a warning).
    """
    if not isinstance(spec, SwarmSpec):
        return ["spec must be a SwarmSpec"]

    e: list[str] = []
    _err(e, _is_nonempty_str(spec.name), "name must be a non-empty string")

    if spec.architect is None or not _is_nonempty_str(spec.architect.provider):
        e.append("missing architect")
    elif spec.architect.model is not None and not isinstance(spec.architect.model, str):
        e.append("architect.model must be a string")

    if spec.operator is not None:
        _err(
            e,
            _is_nonempty_str(spec.operator.provider),
            "operator.provider must be a non-empty string when operator is set",
        )

    _err(e, isinstance(spec.cross_talk, bool), "cross_talk must be a boolean")
    _err(e, isinstance(spec.board, bool), "board must be a boolean")
    if spec.cross_talk and not spec.board:
        e.append("board=false when cross_talk is true")

    _err(
        e,
        spec.communication in SPEC_COMMUNICATION,
        f"communication must be one of {SPEC_COMMUNICATION}",
    )
    _err(e, _is_int(spec.max_depth) and spec.max_depth >= 0, "max_depth must be an integer >= 0")
    _err(
        e,
        _is_int(spec.max_children_per_agent) and spec.max_children_per_agent >= 0,
        "max_children_per_agent must be an integer >= 0",
    )
    _err(e, _is_int(spec.max_agents) and spec.max_agents >= 1, "max_agents must be an integer >= 1")
    _err(e, isinstance(spec.budget, dict), "budget must be an object")
    _err(e, isinstance(spec.captains, list), "captains must be a list")

    seen_ids: set[str] = set()
    total_children = 0
    for i, cap in enumerate(spec.captains):
        label = f"captains[{i}]"
        if not isinstance(cap, CaptainSpec):
            e.append(f"{label} must be a CaptainSpec")
            continue
        _err(e, _is_nonempty_str(cap.id), f"{label}.id must be a non-empty string")
        _err(e, _is_nonempty_str(cap.provider), f"{label}.provider must be a non-empty string")
        _err(e, isinstance(cap.model, str), f"{label}.model must be a string")
        _err(e, _is_int(cap.spawn) and cap.spawn >= 0, f"{label}.spawn must be an integer >= 0")
        _err(e, _is_nonempty_str(cap.spawn_via), f"{label}.spawn_via must be a non-empty string")
        if cap.id:
            if cap.id in seen_ids:
                e.append(f"{label}.id {cap.id!r} is duplicated")
            seen_ids.add(cap.id)
        if _is_int(cap.spawn) and cap.spawn > spec.max_children_per_agent:
            e.append(
                f"{label}.spawn={cap.spawn} exceeds max_children_per_agent="
                f"{spec.max_children_per_agent}"
            )
        if _is_int(cap.spawn) and cap.spawn > 0:
            total_children += cap.spawn

    # Depth: captains are depth 1 under architect; their children are depth 2.
    if spec.captains and spec.max_depth < 1:
        e.append("max_depth too small for captains (need >= 1)")
    if total_children and spec.max_depth < 2:
        e.append("max_depth too small for spawned children (need >= 2)")

    n_seats = 1  # architect
    if spec.operator is not None:
        n_seats += 1
    n_seats += len(spec.captains) + total_children
    if n_seats > spec.max_agents:
        e.append(f"agent count {n_seats} exceeds max_agents={spec.max_agents}")

    roster = _roster_providers(live_roster)
    for label, provider in _seats_to_check(spec):
        if not provider:
            continue
        if provider not in roster:
            e.append(f"unknown provider {provider!r} ({label}) not in live_roster")

    return e


# --- design prompt ----------------------------------------------------------

def _fmt_roster(live_roster: Any) -> str:
    if live_roster is None:
        return "(none — any provider will fail validation)"
    if isinstance(live_roster, str):
        return live_roster
    try:
        return json.dumps(live_roster, indent=2, sort_keys=True)
    except (TypeError, ValueError):
        return repr(live_roster)


def _fmt_constraints(constraints: Any) -> str:
    if constraints is None or constraints == {} or constraints == []:
        return (
            "(none pinned — you choose providers/models from the live roster, "
            "topology, nesting, and board policy)"
        )
    if isinstance(constraints, str):
        return constraints
    try:
        return json.dumps(constraints, indent=2, sort_keys=True)
    except (TypeError, ValueError):
        return repr(constraints)


def _catalog_block() -> str:
    lines = []
    for t in _TOPOLOGY_LIST:
        lines.append(
            f"- `{t.name}` — when: {t.when}\n"
            f"  mechanic: {t.mechanic}\n"
            f"  communication: {t.communication}; nesting: {t.nesting}; "
            f"default_captains={t.default_captains}; default_children={t.default_children}; "
            f"cost: {t.cost_shape}"
        )
    return "\n".join(lines)


def design_prompt(task: str, live_roster: Any, constraints: Any) -> str:
    """Prompt for Fable/Astra: emit ONLY SwarmSpec JSON.

    Grants latitude to invent a custom swarm when catalog forms don't fit.
    User-specified models/providers in ``constraints`` are hard constraints.
    Includes the nested-hive example (4 captains; muse and glm each spawn 4
    andrewcode children; open board; architect talks to all).
    """
    example = dict(NESTED_HIVE_EXAMPLE)
    example["task"] = task
    example_json = json.dumps(example, indent=2)

    return f"""You are Fusion's swarm architect (Fable 5.1 and/or Astra / gpt-6-astra).
Design a SwarmSpec for the task below. Reply with ONLY SwarmSpec JSON — no prose,
no preamble. A markdown ```json fence is tolerated but not required.

TASK:
{task}

HARD CONSTRAINTS (user-pinned providers/models — do not change, substitute, or
"improve" them. Everything else — topology, nesting, who spawns, board policy,
captain count, communication — is YOUR call):
{_fmt_constraints(constraints)}

LIVE ROSTER (the only providers that exist right now. An unknown provider is a
validation ERROR, not a warning. Absent CLIs are absent — do not invent them,
and do not treat absence as agreement):
{_fmt_roster(live_roster)}

BUDGET DEFAULTS (override only if the task needs it and constraints allow):
max_depth={DEFAULT_MAX_DEPTH}, max_children_per_agent={DEFAULT_MAX_CHILDREN},
max_agents={DEFAULT_MAX_AGENTS}.

NAMED CATALOG (prefer one if it fits). You HAVE LATITUDE to invent a custom
swarm when these forms are a poor match: set name to "custom" or a new kebab
name, describe the mechanic in notes, and still emit a valid SwarmSpec. Inventing
a topology that fits the task is encouraged. Do not force-fit nested-hive onto
a solo question, and do not flatten a nested coding swarm into a blind panel.

{_catalog_block()}

CANONICAL NESTED-HIVE EXAMPLE — 4 captains; muse-spark-1.3 and glm-5.3 each
spawn 4 andrewcode children; remaining captains spawn 0; open Hive Board;
architect talks to everyone; captains talk to their children; children of
different captains can talk. Nested workers are ALWAYS real andrewcode
processes (spawn_via="andrewcode") even when the captain itself is
opencode/glm/grok/copilot/kimi. Captains that are not nested processes use
spawn_via="adapter".

{example_json}

SWARMSPEC SCHEMA (unknown fields are rejected):
{{
  "name": "<catalog name or custom>",
  "architect": {{"provider": "<cli>", "model": "<id>"}},
  "operator": {{"provider": "<cli>", "model": "<id>"}} | null,
  "captains": [
    {{"id": "<stable id>", "provider": "<cli>", "model": "<id>",
      "spawn": <int <= max_children_per_agent>, "spawn_via": "andrewcode"|"adapter"}}
  ],
  "cross_talk": <bool>,
  "board": <bool>,
  "max_depth": <int>,
  "max_children_per_agent": <int>,
  "max_agents": <int>,
  "budget": {{}},
  "communication": "open"|"lineage"|"need-to-know",
  "task": "<the task, copied>",
  "notes": "<mechanic / why this shape>"
}}

INVARIANTS:
- If cross_talk is true, board MUST be true (cross-talk rides the Hive Board).
- spawn MUST be <= max_children_per_agent. Over-spawn is an error.
- architect is required.
- Providers MUST be in the live roster. Unknown provider = error.
- Do not simulate, roleplay, or fabricate dispatch. This JSON will be executed
  by real CLIs and real andrewcode child processes.
- communication on the spec is open|lineage|need-to-know (not the catalog's
  blind|board|lineage|open — those describe the named form, not this field).
"""
