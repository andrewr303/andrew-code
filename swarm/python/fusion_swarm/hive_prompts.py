"""Hive Board prompt templates for nested Fusion swarms.

Architect (Fable / Astra) designs a SwarmSpec. Captains (any live CLI) run a
lineage on the Hive Board. Nested workers are real AndrewCode processes that
poll the same board. Nobody except the architect/host talks to the human.

Stdlib only. These functions return strings; they never dispatch a CLI.
"""
from __future__ import annotations

import json
from typing import Any, Iterable, Mapping, Sequence

# Catalog the architect may pick from. Field names match designer.Topology:
# name, when, mechanic, communication (blind|board|lineage|open), nesting,
# default_captains, default_children, cost_shape.
CATALOG: tuple[dict[str, Any], ...] = (
    {
        "name": "solo",
        "when": "one model is enough; no disagreement value",
        "mechanic": "single captain answers; no children",
        "communication": "open",
        "nesting": False,
        "default_captains": 1,
        "default_children": 0,
        "cost_shape": "linear-1",
    },
    {
        "name": "panel",
        "when": "independent takes, then a judge synthesizes",
        "mechanic": "blind parallel fan-out; host synthesizes; absent ≠ agreement",
        "communication": "blind",
        "nesting": False,
        "default_captains": 4,
        "default_children": 0,
        "cost_shape": "parallel-n",
    },
    {
        "name": "council",
        "when": "high-stakes decision that needs round-robin critique",
        "mechanic": "shared context, sequential rounds, then synthesis",
        "communication": "open",
        "nesting": False,
        "default_captains": 4,
        "default_children": 0,
        "cost_shape": "rounds-n",
    },
    {
        "name": "debate",
        "when": "two or more adversarial positions should collide",
        "mechanic": "assigned sides argue; a judge scores; no forced consensus",
        "communication": "open",
        "nesting": False,
        "default_captains": 3,
        "default_children": 0,
        "cost_shape": "rounds-n",
    },
    {
        "name": "vote",
        "when": "the answer is checkable and a majority can pick it",
        "mechanic": "blind proposals, then a model-free majority; ties stay ties",
        "communication": "blind",
        "nesting": False,
        "default_captains": 4,
        "default_children": 0,
        "cost_shape": "parallel-n",
    },
    {
        "name": "swarm",
        "when": "work splits across captains that must coordinate live",
        "mechanic": "captains plus workers on one Hive Board",
        "communication": "board",
        "nesting": True,
        "default_captains": 3,
        "default_children": 2,
        "cost_shape": "nested-n-times-k",
    },
    {
        "name": "hierarchy",
        "when": "a director can decompose and assign isolated subtasks",
        "mechanic": "director plans; workers see only their assignment",
        "communication": "lineage",
        "nesting": True,
        "default_captains": 1,
        "default_children": 4,
        "cost_shape": "star",
    },
    {
        "name": "metaloop",
        "when": "typed contracts, gates, and bounded escalation are required",
        "mechanic": "TaskSpec waves, advisor, fail-closed validation, repair ladder",
        "communication": "lineage",
        "nesting": True,
        "default_captains": 1,
        "default_children": 4,
        "cost_shape": "waves-plus-repair",
    },
    {
        "name": "moa",
        "when": "layered refinement beats a single panel",
        "mechanic": "each layer sees the previous layer; final aggregation",
        "communication": "open",
        "nesting": False,
        "default_captains": 4,
        "default_children": 0,
        "cost_shape": "layers-times-n",
    },
    {
        "name": "heavy",
        "when": "deep analysis with distinct roles (explore/plan/build/review)",
        "mechanic": "four-role loop; optional extra loops",
        "communication": "open",
        "nesting": False,
        "default_captains": 4,
        "default_children": 0,
        "cost_shape": "roles-times-loops",
    },
    {
        "name": "discuss",
        "when": "brainstorming; ideas should bounce",
        "mechanic": "group-chat rounds on a shared transcript",
        "communication": "open",
        "nesting": False,
        "default_captains": 4,
        "default_children": 0,
        "cost_shape": "rounds-n",
    },
    {
        "name": "graph",
        "when": "the work is a typed DAG with explicit edges and gates",
        "mechanic": "nodes are agents; edges are dataflow; schedule by waves",
        "communication": "lineage",
        "nesting": True,
        "default_captains": 4,
        "default_children": 0,
        "cost_shape": "dag-waves",
    },
    {
        "name": "ladder",
        "when": "cheap models should try first; promote only on failure",
        "mechanic": "fast tier, then expert, then host takeover",
        "communication": "lineage",
        "nesting": False,
        "default_captains": 2,
        "default_children": 0,
        "cost_shape": "tiered-escalate",
    },
    {
        "name": "speclock",
        "when": "the spec must freeze before implementation starts",
        "mechanic": "specify, lock, implement against the locked spec, verify",
        "communication": "lineage",
        "nesting": False,
        "default_captains": 2,
        "default_children": 0,
        "cost_shape": "two-phase",
    },
    {
        "name": "breaker",
        "when": "an implementation needs an adversarial audit",
        "mechanic": "builder produces; breaker attacks; host judges evidence",
        "communication": "open",
        "nesting": False,
        "default_captains": 2,
        "default_children": 0,
        "cost_shape": "pair",
    },
    {
        "name": "ballot",
        "when": "voting must be blind, anonymized, and anti-self-vote",
        "mechanic": "proposals anonymized; approval votes; gate breaks ties",
        "communication": "blind",
        "nesting": False,
        "default_captains": 4,
        "default_children": 0,
        "cost_shape": "parallel-n",
    },
    {
        "name": "factory",
        "when": "many similar units of work can run in parallel",
        "mechanic": "identical workers pull tasks from the board",
        "communication": "board",
        "nesting": True,
        "default_captains": 1,
        "default_children": 4,
        "cost_shape": "parallel-k",
    },
    {
        "name": "diamond",
        "when": "expand into options, then compress to one answer",
        "mechanic": "fan-out generation, then a narrowing synthesis",
        "communication": "open",
        "nesting": False,
        "default_captains": 4,
        "default_children": 0,
        "cost_shape": "expand-compress",
    },
    {
        "name": "nested-hive",
        "when": "captains of mixed CLIs each need nested AndrewCode workers",
        "mechanic": "Hive Board; captains spawn andrewcode children; optional cross-talk",
        "communication": "board",
        "nesting": True,
        "default_captains": 4,
        "default_children": 4,
        "cost_shape": "captains-times-children",
    },
    {
        "name": "ultraswarm",
        "when": "the task saturates a nested hive approaching max_agents",
        "mechanic": "many captains, max children, board + lineage channels, tight budget",
        "communication": "board",
        "nesting": True,
        "default_captains": 6,
        "default_children": 3,
        "cost_shape": "near-max-agents",
    },
    {
        "name": "ureview",
        "when": "an existing change needs independent reviewers",
        "mechanic": "reviewers score blindly; host merges findings; absent ≠ approval",
        "communication": "blind",
        "nesting": False,
        "default_captains": 3,
        "default_children": 0,
        "cost_shape": "parallel-n",
    },
    {
        "name": "custom",
        "when": "no catalog form fits; invent a topology",
        "mechanic": "architect-defined; declare mechanic and communication in notes",
        "communication": "board",
        "nesting": True,
        "default_captains": 2,
        "default_children": 2,
        "cost_shape": "unknown",
    },
)

CATALOG_NAMES: tuple[str, ...] = tuple(item["name"] for item in CATALOG)

# Exact invitation phrase tests look for. Present only when cross_talk is true.
CROSS_LINEAGE_INVITATION = (
    "You have a cross-lineage invitation: you may talk to children of other "
    "captains, @mention them, and read their lineage channels."
)

# SpawnLimits defaults (identities.SpawnLimits) — architect must not exceed
# unless constraints raise them.
DEFAULT_MAX_DEPTH = 2
DEFAULT_MAX_CHILDREN = 4
DEFAULT_MAX_AGENTS = 24

# Canonical poll snippet required by the hive contract.
BOARD_POLL_CMD = (
    'python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"'
)

SWARMSPEC_FIELDS = (
    "name",
    "architect",
    "operator",
    "captains",
    "cross_talk",
    "board",
    "max_depth",
    "max_children_per_agent",
    "max_agents",
    "budget",
    "communication",
    "task",
    "notes",
)

__all__ = [
    "CATALOG",
    "CATALOG_NAMES",
    "CROSS_LINEAGE_INVITATION",
    "BOARD_POLL_CMD",
    "board_howto",
    "catalog_summary",
    "architect_prompt",
    "captain_prompt",
    "worker_prompt",
]


def _json(value: Any) -> str:
    return json.dumps(value, indent=2, sort_keys=True, default=str)


def _field(obj: Any, *names: str, default: Any = "") -> Any:
    if obj is None:
        return default
    if isinstance(obj, Mapping):
        for name in names:
            if name in obj and obj[name] is not None:
                return obj[name]
        return default
    for name in names:
        if hasattr(obj, name):
            got = getattr(obj, name)
            if got is not None:
                return got
    return default


def _id_of(obj: Any) -> str:
    if obj is None:
        return ""
    if isinstance(obj, str):
        return obj
    ident = _field(obj, "id", "display_name", "name", default="")
    return str(ident) if ident else str(obj)


def _ids(items: Iterable[Any] | None) -> list[str]:
    if not items:
        return []
    out: list[str] = []
    for item in items:
        ident = _id_of(item)
        if ident:
            out.append(ident)
    return out


def _identity_block(identity: Any) -> str:
    if identity is None:
        return "(unspecified)"
    if isinstance(identity, str):
        return identity
    payload = {
        "id": _field(identity, "id", default=""),
        "display_name": _field(identity, "display_name", default=""),
        "role": _field(identity, "role", default=""),
        "provider": _field(identity, "provider", default=""),
        "model": _field(identity, "model", default=""),
        "parent_id": _field(identity, "parent_id", default=None),
        "lineage": _field(identity, "lineage", default=""),
        "depth": _field(identity, "depth", default=0),
        "spawn_budget": _field(identity, "spawn_budget", default=0),
        "max_depth": _field(identity, "max_depth", default=DEFAULT_MAX_DEPTH),
        "status": _field(identity, "status", default="online"),
    }
    return _json(payload)


def _render_block(value: Any) -> str:
    if value is None:
        return "(none)"
    if isinstance(value, str):
        text = value.strip()
        return text if text else "(none)"
    if isinstance(value, Mapping):
        return _json(dict(value))
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        if not value:
            return "(none)"
        if all(isinstance(item, str) for item in value):
            return ", ".join(value)
        return _json(list(value))
    return str(value)


def _howto(board_howto_text: str | None) -> str:
    """Always include the canonical $FUSION_BOARD / $FUSION_AGENT_ID CLI."""
    extra = (board_howto_text or "").strip()
    if extra and "$FUSION_BOARD" in extra and "$FUSION_AGENT_ID" in extra:
        return extra
    base = board_howto()
    if not extra:
        return base
    return extra + "\n\n" + base


def _spawn_n(identity: Any, spawn_budget: int | None) -> int:
    if spawn_budget is not None:
        try:
            return max(0, int(spawn_budget))
        except (TypeError, ValueError):
            return DEFAULT_MAX_CHILDREN
    raw = _field(identity, "spawn_budget", default=DEFAULT_MAX_CHILDREN)
    try:
        n = int(raw)
    except (TypeError, ValueError):
        n = DEFAULT_MAX_CHILDREN
    return n if n > 0 else DEFAULT_MAX_CHILDREN


def catalog_summary() -> str:
    """Compact Topology list for the architect prompt."""
    lines = [
        "name | when | mechanic | communication | nesting | default_captains | default_children | cost_shape",
        "---- | ---- | -------- | ------------- | ------- | ---------------- | ---------------- | ----------",
    ]
    for item in CATALOG:
        lines.append(
            "{name} | {when} | {mechanic} | {communication} | {nesting} | "
            "{default_captains} | {default_children} | {cost_shape}".format(**item)
        )
    return "\n".join(lines)


def board_howto() -> str:
    """Exact Hive Board CLI nested processes must use. Always prints JSON."""
    return f"""Hive Board CLI — one SQLite board, WAL, no daemon. Always prints JSON.
Env (already set in your process):
  $FUSION_BOARD      path to the sqlite board
  $FUSION_AGENT_ID   your agent id
  $FUSION_PARENT_ID  parent agent id (empty for the architect)
  $FUSION_SWARM_ID   swarm run id

Poll your feed (channels you joined + DMs + @mentions):
  {BOARD_POLL_CMD}

Unread @mentions:
  python -m fusion_swarm.board --db "$FUSION_BOARD" mentions --agent "$FUSION_AGENT_ID"

Post to a room (default channel is hive; @mention others in the body as @agent-id):
  python -m fusion_swarm.board --db "$FUSION_BOARD" post --from "$FUSION_AGENT_ID" --body "progress: ..." --channel hive

DM (canonical channel dm:<sorted_a>:<sorted_b>):
  python -m fusion_swarm.board --db "$FUSION_BOARD" dm --from "$FUSION_AGENT_ID" --to OTHER_ID --body "..."

Reply in a thread:
  python -m fusion_swarm.board --db "$FUSION_BOARD" reply --from "$FUSION_AGENT_ID" --message-id MSG_ID --body "..."

Ack a message you acted on:
  python -m fusion_swarm.board --db "$FUSION_BOARD" ack --agent "$FUSION_AGENT_ID" --message-id MSG_ID

Heartbeat (keep presence online):
  python -m fusion_swarm.board --db "$FUSION_BOARD" heartbeat --agent "$FUSION_AGENT_ID"

Join a channel (lineage-<captain>, task-main, hive, captains, workers):
  python -m fusion_swarm.board --db "$FUSION_BOARD" join --channel CHANNEL --agent "$FUSION_AGENT_ID"

Inspect roster / tree / channels:
  python -m fusion_swarm.board --db "$FUSION_BOARD" agents
  python -m fusion_swarm.board --db "$FUSION_BOARD" tree
  python -m fusion_swarm.board --db "$FUSION_BOARD" channels
"""


def architect_prompt(task, roster, constraints) -> str:
    """Prompt for Fable/Astra: emit ONLY SwarmSpec JSON.

    User-specified models/providers in ``constraints`` are hard. Catalog forms
    are suggestions; the architect may invent a custom topology when none fit.
    """
    example = {
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
        ],
        "cross_talk": True,
        "board": True,
        "max_depth": DEFAULT_MAX_DEPTH,
        "max_children_per_agent": DEFAULT_MAX_CHILDREN,
        "max_agents": DEFAULT_MAX_AGENTS,
        "budget": {},
        "communication": "open",
        "task": str(task) if task is not None else "",
        "notes": "",
    }
    names = ", ".join(CATALOG_NAMES)
    return f"""You are the top-level Fusion architect (Fable 5.1 and/or Astra via Codex gpt-6-astra).
You talk to the human. You DESIGN a nested multi-agent coding swarm. You do not
implement the task yourself.

TASK:
{_render_block(task)}

LIVE ROSTER (the only dispatchable providers/models — absent ≠ agreement; do not invent CLIs):
{_render_block(roster)}

CONSTRAINTS:
{_render_block(constraints)}

HARD CONSTRAINTS (do not override):
- Any user-specified provider or model in CONSTRAINTS is locked. Do not swap it.
- Dispatch only providers that appear on the LIVE ROSTER. Missing providers are
  absent, not silent votes, not stand-ins, not "probably fine".
- Nested workers are always real AndrewCode processes even when a captain is
  opencode/glm/grok/copilot/kimi. Captains that are not nested processes go
  through the adapter; their children still spawn via andrewcode.
- Stay inside SpawnLimits unless CONSTRAINTS raise them: max_depth={DEFAULT_MAX_DEPTH},
  max_children_per_agent={DEFAULT_MAX_CHILDREN}, max_agents={DEFAULT_MAX_AGENTS}.
- Communication among nested processes is ONE Hive Board (file+SQLite, WAL, no
  daemon). Spawned processes receive $FUSION_BOARD and $FUSION_AGENT_ID.

CATALOG OF NAMED FORMS (pick one, or invent):
{names}

{catalog_summary()}

LATITUDE:
If no catalog form fits, invent a custom topology. Set name to a new kebab-case
identifier (or "custom") and put the mechanic in notes. You choose captains,
nesting, cross_talk, communication (open|lineage|need-to-know), and budget
within the hard constraints. User-specified models/providers stay locked;
everything else is your call.

OUTPUT CONTRACT — emit ONLY a SwarmSpec JSON object. No preamble, no commentary,
no chain of thought. Optional markdown ```json fences are tolerated. Fields
(fail-closed; all required):
  name                     string (catalog form or custom kebab-case)
  architect                {{provider, model}}
  operator                 {{provider, model}} or string provider
  captains                 list of {{id, provider, model, spawn, spawn_via}}
                           spawn = child count (int); spawn_via = andrewcode|adapter
  cross_talk               bool (children of different captains may talk)
  board                    bool (must be true for nested-hive / swarm / ultraswarm)
  max_depth                int
  max_children_per_agent   int
  max_agents               int
  budget                   object (token/time/call caps; empty object is ok)
  communication            "open" | "lineage" | "need-to-know"
  task                     string (echo the TASK)
  notes                    string

Example (shape only — replace with your design):
{_json(example)}

SwarmSpec JSON only. Begin now.
"""


def captain_prompt(identity, task, board_howto, children_ids, *,
                   cross_talk: bool = True, spawn_budget: int | None = None) -> str:
    """Prompt for a captain (any live CLI) running a lineage on the Hive Board."""
    howto = _howto(board_howto)
    children = _ids(children_ids)
    n = _spawn_n(identity, spawn_budget)
    ident = _id_of(identity) or "captain"
    if children:
        child_block = (
            "These andrewcode children are already spawned. Do not re-spawn them. "
            "Talk to them on the board (your lineage channel and DMs):\n  - "
            + "\n  - ".join(children)
        )
        spawn_block = (
            f"You may ask the host/board to spawn additional andrewcode children "
            f"only if the listed set is under your budget of {n} and SpawnLimits "
            f"still allow it. Ask by posting on channel `system` or `architect` "
            f"with @architect and the child model you want."
        )
    else:
        child_block = "No children have been spawned yet."
        spawn_block = (
            f"You may spawn up to {n} andrewcode children by asking the host/board "
            f"(post on channel `system` or `architect`, @mention the architect, "
            f"state count + model). Do not shell out to andrewcode yourself — the "
            f"host enforces depth/budget. Children, once spawned, are nested "
            f"AndrewCode processes; you talk to them only via the Hive Board."
        )
    if cross_talk:
        xtalk = (
            "You may @mention other captains and, because cross_talk is on, "
            + CROSS_LINEAGE_INVITATION
        )
    else:
        xtalk = (
            "You may @mention other captains on channel `captains` or `hive`. "
            "Do not @mention other captains' children; they stay in their lineage."
        )
    return f"""You are Fusion captain `{ident}`.
You are NOT the human interface. Never address the human. Only the architect/host does that.

YOUR IDENTITY:
{_identity_block(identity)}

TASK:
{_render_block(task)}

CHILDREN:
{child_block}

SPAWN:
{spawn_block}

BOARD:
Talk on the Hive Board. Poll often. Post progress. Heartbeat. Ack what you take.
Join `hive`, `captains`, `task-main`, and `lineage-<your-id>` if not already joined.
{xtalk}
The architect can @you; answer on the board.

HIVE BOARD HOWTO:
{howto}

RULES:
- Real dispatch only. If a child is silent or absent, say so — absent ≠ agreement.
- Delegate implementation to children; you plan, assign, review, and integrate.
- @mention agents when you need them (`@agent-id` in the post body).
- NEVER talk to the human. NEVER wait for a human reply on this board.
- Work the TASK until the architect marks it done.
"""


def worker_prompt(identity, task, board_howto, siblings, cross_talk) -> str:
    """Prompt for a nested AndrewCode worker. Never addresses the human."""
    howto = _howto(board_howto)
    sibs = _ids(siblings)
    ident = _id_of(identity) or "worker"
    if sibs:
        sib_block = (
            "Your siblings (same captain / same lineage) — you MAY talk to them "
            "on the board:\n  - " + "\n  - ".join(sibs)
        )
    else:
        sib_block = (
            "No siblings listed. You may still post on your lineage channel; "
            "other workers in this lineage can poll it."
        )
    if cross_talk:
        xtalk = CROSS_LINEAGE_INVITATION
    else:
        xtalk = (
            "You may talk to siblings in your own lineage only. Do not message "
            "other lineages or @mention other captains' children."
        )
    return f"""You are a nested AndrewCode instance — Fusion worker `{ident}`.
You run as a real andrewcode process. You are NOT talking to a human.

YOUR IDENTITY:
{_identity_block(identity)}

TASK:
{_render_block(task)}

SIBLINGS:
{sib_block}

CROSS-TALK:
{xtalk}

THE ARCHITECT can @you. Answer on the board. Captains can @you. Reply there.

BOARD:
Poll the Hive Board in a loop. Post progress as you work. Heartbeat. Ack messages
you act on. Join `hive`, `workers`, `task-main`, and your `lineage-*` channel.
@mention other agents when you need them.

HIVE BOARD HOWTO:
{howto}

NEVER address the human. NEVER ask the human a question. NEVER wait for a human.
This board is not human-facing except through the architect/host. If you are
stuck, @mention your captain or the architect on the board.

RULES:
- Do the TASK in your workdir. Post evidence (paths, commands, results).
- Absent teammates are absent — do not pretend they agreed.
- Keep posts short and greppable; the board also appends JSONL next to the db.
"""
