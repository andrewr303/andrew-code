"""Hive orchestrator — nested multi-agent coding swarm over one Hive Board.

The architect talks to the human. Captains own a lineage. Nested workers are
REAL AndrewCode processes. Everyone except the architect talks on the board.

``run()`` is the engine. ``dry_run=True`` still creates the sqlite board,
registers architect + operator + captains + children, joins them to hive +
lineage channels + workers, and seeds the task post from the architect. It
does **not** subprocess AndrewCode or paid CLIs.

If no spec is given, tests get a design packet (prompt + roster) rather than
a live Fable/Astra call. Live dispatch is never invented: absent ≠ agreement.

Stdlib only. Fail-closed. Windows + Git Bash.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, is_dataclass
from pathlib import Path
from typing import Any, Optional

from .board import HiveBoard
from .identities import AgentIdentity, SpawnLimits, child, new_id

# Default nested-hive example from the skill: muse-spark-1.3 + glm-5.3, each
# with 4 AndrewCode children. Extra captains (if requested) fill from this
# live-CLI catalog. Children are ALWAYS andrewcode identities even when the
# captain is opencode/glm.
# Nested workers are always AndrewCode processes. Captains that are not
# andrewcode keep their own model; their children run the worker model.
DEFAULT_CHILD_MODEL = os.environ.get(
    "FUSION_ANDREWCODE_MODEL", "meta/muse-spark-1.3-contributor"
)

DEFAULT_CAPTAIN_CATALOG = (
    {"id": "muse", "provider": "andrewcode", "model": "muse-spark-1.3",
     "spawn": 4, "spawn_via": "andrewcode"},
    {"id": "glm", "provider": "opencode", "model": "glm-5.3",
     "spawn": 4, "spawn_via": "andrewcode"},
    {"id": "grok", "provider": "grok", "model": "grok-4.5",
     "spawn": 4, "spawn_via": "andrewcode"},
    {"id": "copilot", "provider": "copilot", "model": "gemini-3.5-flash",
     "spawn": 4, "spawn_via": "andrewcode"},
    {"id": "kimi", "provider": "kimi", "model": "azure/kimi-k3",
     "spawn": 4, "spawn_via": "andrewcode"},
    {"id": "codex", "provider": "codex", "model": "gpt-6-astra",
     "spawn": 4, "spawn_via": "andrewcode"},
)

ARCHITECT_SEATS = {
    "fable": {"provider": "fable", "model": "fable-5.1"},
    "astra": {"provider": "codex", "model": "gpt-6-astra"},
    "codex": {"provider": "codex", "model": "gpt-6-astra"},
}

# Alias tokens the CLI / skill use for captains.
_CAPTAIN_ALIASES = {
    "muse": "muse",
    "muse-spark-1.3": "muse",
    "andrewcode": "muse",
    "glm": "glm",
    "glm-5.3": "glm",
    "opencode": "glm",
    "grok": "grok",
    "copilot": "copilot",
    "kimi": "kimi",
    "codex": "codex",
}

DEFAULT_OPERATOR = {"provider": "codex", "model": "in-context"}


class HiveError(ValueError):
    """Raised when a hive run is rejected. Fail-closed."""


# ---------------------------------------------------------------------------
# Optional sibling imports (designer / prompts / spawn). Keep at function
# level so dry_run still works when only board.py + identities.py exist.
# ---------------------------------------------------------------------------

def _import_designer():
    try:
        from . import designer as designer_mod
        return designer_mod
    except ImportError:
        return None


def _import_prompts():
    try:
        from . import hive_prompts as prompts_mod
        return prompts_mod
    except ImportError:
        return None


def _import_spawn():
    try:
        from . import spawn as spawn_mod
        return spawn_mod
    except ImportError:
        return None


def _as_dict(obj: Any) -> dict[str, Any]:
    if obj is None:
        return {}
    if is_dataclass(obj) and not isinstance(obj, type):
        return asdict(obj)
    if hasattr(obj, "to_dict") and callable(obj.to_dict):
        return obj.to_dict()
    if isinstance(obj, dict):
        return dict(obj)
    raise HiveError(f"cannot serialize {type(obj).__name__}")


def _state_root(state_dir: Optional[str]) -> Path:
    if state_dir:
        root = Path(state_dir)
    else:
        env = os.environ.get("FUSION_STATE_DIR")
        root = Path(env) if env else Path.home() / ".fusion"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _architect_seat(architect: str) -> dict[str, str]:
    key = (architect or "fable").strip().lower()
    if key not in ARCHITECT_SEATS:
        raise HiveError(
            f"unknown architect {architect!r}; expected one of {sorted(ARCHITECT_SEATS)}"
        )
    return dict(ARCHITECT_SEATS[key])


def _catalog_by_id() -> dict[str, dict[str, Any]]:
    return {c["id"]: dict(c) for c in DEFAULT_CAPTAIN_CATALOG}


def _resolve_captain_token(token: str) -> dict[str, Any]:
    raw = (token or "").strip()
    if not raw:
        raise HiveError("empty captain token")
    catalog = _catalog_by_id()
    alias = _CAPTAIN_ALIASES.get(raw.lower(), raw.lower())
    if alias in catalog:
        rec = dict(catalog[alias])
        rec["id"] = alias
        return rec
    # Bare provider name that is not in the alias table: treat as a custom
    # captain whose children still spawn via andrewcode.
    return {
        "id": alias,
        "provider": raw,
        "model": raw,
        "spawn": 4,
        "spawn_via": "andrewcode",
    }


def _default_captains(n: int = 2) -> list[dict[str, Any]]:
    return [dict(c) for c in DEFAULT_CAPTAIN_CATALOG[: max(1, int(n))]]


def _parse_captains_arg(captains: Any) -> list[dict[str, Any]]:
    if captains is None:
        return _default_captains(2)
    if isinstance(captains, str):
        tokens = [t.strip() for t in captains.split(",") if t.strip()]
        if not tokens:
            return _default_captains(2)
        return [_resolve_captain_token(t) for t in tokens]
    if isinstance(captains, (list, tuple)):
        out: list[dict[str, Any]] = []
        for item in captains:
            if isinstance(item, dict):
                rec = dict(item)
                if "id" not in rec or not rec["id"]:
                    raise HiveError("captain dict needs an id")
                rec.setdefault("provider", rec["id"])
                rec.setdefault("model", rec.get("provider", rec["id"]))
                rec.setdefault("spawn", 4)
                rec.setdefault("spawn_via", "andrewcode")
                out.append(rec)
            elif isinstance(item, str):
                out.append(_resolve_captain_token(item))
            elif is_dataclass(item) and not isinstance(item, type):
                rec = asdict(item) if not hasattr(item, "to_dict") else item.to_dict()
                if "id" not in rec or not rec["id"]:
                    raise HiveError("captain dict needs an id")
                rec.setdefault("provider", rec["id"])
                rec.setdefault("model", rec.get("provider", rec["id"]))
                rec.setdefault("spawn", 4)
                rec.setdefault("spawn_via", "andrewcode")
                out.append(rec)
            else:
                raise HiveError(f"captain entry must be str or dict, got {type(item).__name__}")
        return out or _default_captains(2)
    raise HiveError("captains must be a csv string or a list")


def _load_spec_file(path: str) -> Any:
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    designer = _import_designer()
    if designer is not None and hasattr(designer, "parse_swarm_spec"):
        return designer.parse_swarm_spec(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError as ex:
        raise HiveError(f"spec_file is not valid JSON: {ex}") from ex


def _spec_captains(spec: Any) -> list[dict[str, Any]]:
    if spec is None:
        return []
    caps = getattr(spec, "captains", None)
    if caps is None and isinstance(spec, dict):
        caps = spec.get("captains")
    if not caps:
        return []
    return _parse_captains_arg(caps)


def _spec_field(spec: Any, name: str, default: Any = None) -> Any:
    if spec is None:
        return default
    if is_dataclass(spec) and not isinstance(spec, type):
        return getattr(spec, name, default)
    if isinstance(spec, dict):
        return spec.get(name, default)
    return getattr(spec, name, default)


def _live_roster() -> dict[str, Any]:
    """Provider-keyed catalog roster for ``validate_spec``.

    Does NOT shell detect.sh / paid CLIs — ``available`` is left None so a
    design packet never pretends a missing CLI agreed. Keys are provider
    names (``fable``, ``andrewcode``, …) because ``designer.validate_spec``
    treats dict keys as the live roster.
    """
    try:
        from . import adapter
        return {
            p: {
                "provider": p,
                "model": (meta or {}).get("model"),
                "available": None,
            }
            for p, meta in adapter.PROVIDER_META.items()
        }
    except Exception:
        return {
            p: {"provider": p, "available": None}
            for p in (
                "fable", "codex", "andrewcode", "opencode",
                "grok", "copilot", "kimi", "agy",
            )
        }


def _design_packet(task: str, constraints: dict[str, Any]) -> dict[str, Any]:
    roster = _live_roster()
    designer = _import_designer()
    prompt = ""
    if designer is not None and hasattr(designer, "design_prompt"):
        prompt = designer.design_prompt(task, roster, constraints)
    else:
        prompt = (
            "Emit ONLY SwarmSpec JSON for this hive task. Catalog forms are "
            "hints; invent a custom topology if they do not fit. "
            "User-specified models/providers are hard constraints.\n\n"
            f"TASK:\n{task}\n\nCONSTRAINTS:\n"
            + json.dumps(constraints, ensure_ascii=False, indent=2)
            + "\n\nROSTER:\n"
            + json.dumps(roster, ensure_ascii=False, indent=2)
        )
    return {
        "pattern": "hive",
        "design": True,
        "design_prompt": prompt,
        "roster": roster,
        "constraints": constraints,
        "task": task,
        "dry_run": True,
    }


def _lineage_channel(captain_id: str) -> str:
    return f"lineage-{captain_id}"


def _join_rooms(board: HiveBoard, agent_id: str, rooms: list[str]) -> None:
    for room in rooms:
        board.join(room, agent_id)


def _register_identity(board: HiveBoard, ident: AgentIdentity) -> dict[str, Any]:
    return board.register(ident)


def _board_howto() -> str:
    prompts = _import_prompts()
    if prompts is not None and hasattr(prompts, "board_howto"):
        return prompts.board_howto()
    return (
        'python -m fusion_swarm.board --db "$FUSION_BOARD" poll '
        '--agent "$FUSION_AGENT_ID"\n'
        'python -m fusion_swarm.board --db "$FUSION_BOARD" post '
        '--from "$FUSION_AGENT_ID" --body "..." --channel hive\n'
        'python -m fusion_swarm.board --db "$FUSION_BOARD" dm '
        '--from "$FUSION_AGENT_ID" --to <other-id> --body "..."\n'
        'python -m fusion_swarm.board --db "$FUSION_BOARD" reply '
        '--from "$FUSION_AGENT_ID" --message-id <id> --body "..."\n'
        'python -m fusion_swarm.board --db "$FUSION_BOARD" mentions '
        '--agent "$FUSION_AGENT_ID"\n'
        'python -m fusion_swarm.board --db "$FUSION_BOARD" ack '
        '--agent "$FUSION_AGENT_ID" --message-id <id>\n'
        'python -m fusion_swarm.board --db "$FUSION_BOARD" heartbeat '
        '--agent "$FUSION_AGENT_ID"\n'
        'python -m fusion_swarm.board --db "$FUSION_BOARD" join '
        '--channel <name> --agent "$FUSION_AGENT_ID"\n'
        "Post progress. @mention other agents when you need them. "
        "NEVER talk to the human."
    )


def _child_prompt(identity: AgentIdentity, task: str, siblings: list[str],
                  cross_talk: bool) -> str:
    prompts = _import_prompts()
    howto = _board_howto()
    if prompts is not None and hasattr(prompts, "worker_prompt"):
        return prompts.worker_prompt(identity, task, howto, siblings, cross_talk)
    sibs = ", ".join(siblings) or "(none)"
    xt = "You MAY DM / @mention children of other captains." if cross_talk else (
        "Stay in your lineage unless the architect @mentions you."
    )
    return (
        f"You are worker {identity.id} (lineage {identity.lineage}).\n"
        f"TASK:\n{task}\n\nSiblings: {sibs}\n{xt}\n\n"
        f"Hive Board CLI:\n{howto}\n"
        "Post progress. NEVER talk to the human."
    )


def _captain_prompt(identity: AgentIdentity, task: str, children_ids: list[str]) -> str:
    prompts = _import_prompts()
    howto = _board_howto()
    if prompts is not None and hasattr(prompts, "captain_prompt"):
        return prompts.captain_prompt(identity, task, howto, children_ids)
    kids = ", ".join(children_ids) or "(none yet)"
    return (
        f"You are captain {identity.id} (provider={identity.provider}, "
        f"model={identity.model}).\nTASK:\n{task}\n\nYour children: {kids}\n\n"
        f"Hive Board CLI:\n{howto}\n"
        "Talk to your children on the lineage channel. NEVER talk to the human."
    )


def _pythonpath() -> str:
    return str(Path(__file__).resolve().parent.parent)


def _maybe_spawn(
    *,
    dry_run: bool,
    identity: AgentIdentity,
    prompt: str,
    board_path: str,
    workdir: str,
    timeout: Optional[int],
    spawn_via: str,
    run_id: str,
) -> Optional[dict[str, Any]]:
    """Live spawn only when not dry_run. Missing spawn.py is a hard fail on
    the live path (never silently skip a real dispatch). Dry-run never
    subprocesses.
    """
    if dry_run:
        return None
    spawn_mod = _import_spawn()
    if spawn_mod is None:
        raise HiveError(
            "fusion_swarm.spawn is required for a live hive run "
            "(dry_run=False); it is missing"
        )
    extra_env = {"FUSION_SWARM_ID": run_id}
    via = (spawn_via or "andrewcode").strip().lower()
    if via in ("andrewcode", "muse", ""):
        handle = spawn_mod.spawn_andrewcode(
            identity, prompt, board_path, workdir,
            extra_env=extra_env, timeout=timeout,
            fusion_pythonpath=_pythonpath(),
            swarm_id=run_id,
        )
    else:
        handle = spawn_mod.spawn_via_adapter(
            via, identity, prompt, board_path,
            workdir=workdir, extra_env=extra_env, timeout=timeout,
            fusion_pythonpath=_pythonpath(),
            swarm_id=run_id,
        )
    if hasattr(handle, "__dict__"):
        return {
            k: getattr(handle, k)
            for k in ("agent_id", "provider", "model", "pid", "out_path",
                      "log_path", "status", "returncode")
            if hasattr(handle, k)
        }
    if isinstance(handle, dict):
        return dict(handle)
    return {"agent_id": identity.id, "status": "spawned"}


def _coerce_spec(spec: Any) -> Any:
    """Accept a SwarmSpec instance or a plain dict. Dicts are parsed through
    designer.SwarmSpec.from_dict when designer is present so fail-closed
    validation actually runs.
    """
    if spec is None:
        return None
    designer = _import_designer()
    if designer is None:
        return spec
    swarm_cls = getattr(designer, "SwarmSpec", None)
    if swarm_cls is not None and isinstance(spec, swarm_cls):
        return spec
    if isinstance(spec, dict) and hasattr(swarm_cls, "from_dict"):
        try:
            return swarm_cls.from_dict(spec)
        except Exception as ex:
            raise HiveError(f"invalid SwarmSpec: {ex}") from ex
    return spec


def _validate_spec(spec: Any, roster: dict[str, Any]) -> list[str]:
    designer = _import_designer()
    if designer is None or not hasattr(designer, "validate_spec"):
        return []
    swarm_cls = getattr(designer, "SwarmSpec", None)
    if swarm_cls is not None and not isinstance(spec, swarm_cls):
        # Unparseable leftover (e.g. designer missing from_dict) — skip.
        return []
    # Provider-keyed roster from adapter.PROVIDER_META, plus any providers the
    # spec itself names (so a dry-run custom spec is not rejected just because
    # detect.sh was never probed — availability is never invented).
    check_roster: dict[str, Any] = {}
    if isinstance(roster, dict):
        check_roster.update(roster)
    elif isinstance(roster, (list, tuple, set)):
        for p in roster:
            if isinstance(p, str) and p.strip():
                check_roster[p.strip()] = {"provider": p.strip()}
    for rec in (
        _spec_field(spec, "architect"),
        _spec_field(spec, "operator"),
        *(_spec_field(spec, "captains", []) or []),
    ):
        p = None
        if isinstance(rec, dict):
            p = rec.get("provider")
        elif rec is not None and hasattr(rec, "provider"):
            p = rec.provider
        if isinstance(p, str) and p.strip() and p not in check_roster:
            check_roster[p.strip()] = {"provider": p.strip()}
    return list(designer.validate_spec(spec, check_roster) or [])


def run(
    task: str,
    spec: Any = None,
    spec_file: Optional[str] = None,
    architect: str = "fable",
    children_per_captain: int = 4,
    captains: Any = None,
    dry_run: bool = False,
    timeout: Optional[int] = None,
    state_dir: Optional[str] = None,
) -> dict[str, Any]:
    """Run (or dry-run) a nested hive.

    If neither ``spec`` nor ``spec_file`` is given AND ``dry_run`` is False,
    return a design packet (prompt + roster) rather than calling live models.
    Dry-run without a spec still builds the default muse+glm tree so tests
    and ``--dry-run`` have a real board to inspect.
    """
    if not isinstance(task, str) or not task.strip():
        raise HiveError("task must be a non-empty string")
    if not isinstance(children_per_captain, int) or isinstance(children_per_captain, bool):
        raise HiveError("children_per_captain must be an integer")
    if children_per_captain < 0:
        raise HiveError("children_per_captain must be >= 0")

    if spec_file:
        spec = _load_spec_file(spec_file)
    spec = _coerce_spec(spec)

    n_children = int(children_per_captain)
    spec_caps = _spec_captains(spec)
    if spec_caps:
        captain_recs = spec_caps
        # Spec spawn counts win unless the caller explicitly overrode via
        # children_per_captain on a spec-less default run. When the spec
        # already names spawn, honour it; still allow a positive override.
        if captains is None and children_per_captain == 4:
            pass  # keep spec spawn values
        else:
            for rec in captain_recs:
                rec["spawn"] = n_children
    elif captains is not None:
        captain_recs = _parse_captains_arg(captains)
        for rec in captain_recs:
            rec["spawn"] = n_children
    else:
        captain_recs = _default_captains(2)
        for rec in captain_recs:
            rec["spawn"] = n_children

    seat = _architect_seat(
        _spec_field(spec, "architect", None)
        if isinstance(_spec_field(spec, "architect", None), str)
        else architect
    )
    # SwarmSpec.architect may be a dict {provider, model}.
    spec_arch = _spec_field(spec, "architect", None)
    if isinstance(spec_arch, dict):
        seat = {
            "provider": spec_arch.get("provider") or seat["provider"],
            "model": spec_arch.get("model") or seat["model"],
        }
    elif spec_arch is not None and hasattr(spec_arch, "provider"):
        seat = {
            "provider": spec_arch.provider or seat["provider"],
            "model": getattr(spec_arch, "model", None) or seat["model"],
        }

    max_depth = int(_spec_field(spec, "max_depth", 2) or 2)
    max_children = int(_spec_field(spec, "max_children_per_agent", 4) or 4)
    max_agents = int(_spec_field(spec, "max_agents", 24) or 24)
    cross_talk = bool(_spec_field(spec, "cross_talk", True))
    communication = _spec_field(spec, "communication", "open") or "open"

    limits = SpawnLimits(
        max_depth=max_depth,
        max_children_per_agent=max_children,
        max_agents=max_agents,
    )

    constraints = {
        "architect": seat,
        "captains": [c["id"] for c in captain_recs],
        "children_per_captain": n_children,
        "max_depth": max_depth,
        "max_children_per_agent": max_children,
        "max_agents": max_agents,
        "dry_run": bool(dry_run),
        "user_specified_captains": captains is not None or bool(spec_caps),
    }

    # No spec on a live (non-dry) run → design packet, never a fake Fable call.
    if spec is None and not dry_run:
        return _design_packet(task.strip(), constraints)

    roster = _live_roster()
    if spec is not None:
        errs = _validate_spec(spec, roster)
        if errs:
            raise HiveError("invalid SwarmSpec: " + "; ".join(errs))

    run_id = f"hive-{uuid.uuid4().hex[:10]}"
    root = _state_root(state_dir)
    hive_dir = root / "hive" / run_id
    hive_dir.mkdir(parents=True, exist_ok=True)
    board_path = str(hive_dir / "board.sqlite")
    workdir = str(hive_dir)

    architect_id = "arch"
    operator_id = "operator"

    arch_ident = AgentIdentity(
        id=architect_id,
        display_name="Architect",
        role="architect",
        provider=seat["provider"],
        model=seat["model"],
        parent_id=None,
        lineage=architect_id,
        depth=0,
        spawn_budget=len(captain_recs),
        max_depth=max_depth,
        status="online",
    )
    op_provider = DEFAULT_OPERATOR["provider"]
    op_model = DEFAULT_OPERATOR["model"]
    spec_op = _spec_field(spec, "operator", None)
    if isinstance(spec_op, dict):
        op_provider = spec_op.get("provider") or op_provider
        op_model = spec_op.get("model") or op_model
    elif spec_op is not None and hasattr(spec_op, "provider"):
        op_provider = spec_op.provider or op_provider
        op_model = getattr(spec_op, "model", None) or op_model
    elif isinstance(spec_op, str) and spec_op.strip():
        op_provider = spec_op.strip()
    op_ident = AgentIdentity(
        id=operator_id,
        display_name="Operator",
        role="operator",
        provider=op_provider,
        model=op_model,
        parent_id=None,
        lineage=operator_id,
        depth=0,
        spawn_budget=0,
        max_depth=max_depth,
        status="online",
    )

    posts_seeded: list[dict[str, Any]] = []
    spawned: list[dict[str, Any]] = []
    captain_idents: list[AgentIdentity] = []
    child_idents: list[AgentIdentity] = []
    children_by_captain: dict[str, list[str]] = {}

    with HiveBoard(board_path) as board:
        _register_identity(board, arch_ident)
        _register_identity(board, op_ident)

        task_channel = board.ensure_channel(
            "task-main", kind="task", created_by=architect_id,
        )
        board.join(task_channel, architect_id)
        board.join(task_channel, operator_id)

        total = 2  # architect + operator already registered
        for rec in captain_recs:
            cap_id = rec["id"]
            if cap_id in (architect_id, operator_id):
                cap_id = new_id(cap_id)
                rec = dict(rec)
                rec["id"] = cap_id
            ok, reason = limits.can_spawn(arch_ident, total, len(captain_idents))
            if not ok:
                raise HiveError(f"cannot spawn captain {cap_id}: {reason}")
            cap_ident = child(
                arch_ident,
                id=cap_id,
                display_name=rec.get("display_name") or cap_id,
                role="captain",
                provider=rec["provider"],
                model=rec["model"],
                spawn_budget=int(rec.get("spawn") or 0),
                max_depth=max_depth,
            )
            _register_identity(board, cap_ident)
            total += 1
            captain_idents.append(cap_ident)

            lin = board.ensure_channel(
                _lineage_channel(cap_ident.id),
                kind="lineage",
                created_by=architect_id,
            )
            board.join(lin, architect_id)
            board.join(lin, operator_id)
            board.join(lin, cap_ident.id)
            board.join("captains", cap_ident.id)
            board.join(task_channel, cap_ident.id)

        # Children — always andrewcode identities. An andrewcode captain
        # passes its model as -m; other captains' children run DEFAULT_CHILD_MODEL.
        for cap_ident, rec in zip(captain_idents, captain_recs):
            n = int(rec.get("spawn") or 0)
            kids: list[str] = []
            for i in range(n):
                current_children = len(children_by_captain.get(cap_ident.id, []))
                ok, reason = limits.can_spawn(cap_ident, total, current_children)
                if not ok:
                    raise HiveError(
                        f"cannot spawn child of {cap_ident.id}: {reason}"
                    )
                kid_id = f"{cap_ident.id}-{i + 1}"
                # Nested workers are AndrewCode processes. Only an andrewcode
                # captain passes its own model through as -m; otherwise the
                # child runs FUSION_ANDREWCODE_MODEL (muse), never glm/grok.
                kid_model = (
                    cap_ident.model
                    if cap_ident.provider == "andrewcode"
                    else DEFAULT_CHILD_MODEL
                )
                kid = child(
                    cap_ident,
                    id=kid_id,
                    display_name=kid_id,
                    role="child",
                    provider="andrewcode",
                    model=kid_model,
                    spawn_budget=0,
                    max_depth=max_depth,
                )
                _register_identity(board, kid)
                total += 1
                child_idents.append(kid)
                kids.append(kid.id)
                children_by_captain[cap_ident.id] = kids

                lin = _lineage_channel(cap_ident.id)
                board.join(lin, kid.id)
                board.join("workers", kid.id)
                board.join("hive", kid.id)
                board.join(task_channel, kid.id)
                if cross_talk:
                    # Cross-lineage talk is board-native via hive + DMs; joining
                    # hive (already auto on register) is enough. Stay explicit.
                    board.join("hive", kid.id)

        seed = board.post(
            from_agent=architect_id,
            body=task.strip(),
            channel="hive",
            kind="message",
        )
        posts_seeded.append(seed)
        task_post = board.post(
            from_agent=architect_id,
            body=task.strip(),
            channel=task_channel,
            kind="message",
        )
        posts_seeded.append(task_post)

        # Optional: seed a system note so workers see the board_howto without
        # a live architect call.
        howto_post = board.post(
            from_agent=operator_id,
            body=_board_howto(),
            channel="system",
            kind="system",
        )
        posts_seeded.append(howto_post)

        if not dry_run:
            jobs: list[tuple[AgentIdentity, str, str]] = []
            for cap_ident, rec in zip(captain_idents, captain_recs):
                kids = children_by_captain.get(cap_ident.id, [])
                # Captains that are not nested AndrewCode processes go through
                # the verified adapter. Children always spawn via andrewcode.
                cap_via = cap_ident.provider if cap_ident.provider != "andrewcode" else "andrewcode"
                jobs.append((
                    cap_ident,
                    _captain_prompt(cap_ident, task.strip(), kids),
                    cap_via,
                ))
            all_child_ids = [k.id for k in child_idents]
            for kid in child_idents:
                parent_kids = children_by_captain.get(kid.parent_id or "", [])
                siblings = [s for s in parent_kids if s != kid.id]
                if cross_talk:
                    extra = [s for s in all_child_ids if s != kid.id and s not in siblings]
                    siblings = siblings + extra
                jobs.append((
                    kid,
                    _child_prompt(kid, task.strip(), siblings, cross_talk),
                    "andrewcode",
                ))
            workers = min(8, max(1, len(jobs)))
            with ThreadPoolExecutor(max_workers=workers) as ex:
                futs = [
                    ex.submit(
                        _maybe_spawn,
                        dry_run=False,
                        identity=ident,
                        prompt=prompt,
                        board_path=board_path,
                        workdir=workdir,
                        timeout=timeout,
                        spawn_via=via,
                        run_id=run_id,
                    )
                    for ident, prompt, via in jobs
                ]
                for fut in as_completed(futs):
                    handle = fut.result()
                    if handle:
                        spawned.append(handle)

        agents = board.agents()
        tree = board.tree()

    spec_out: Any
    if spec is None:
        spec_out = {
            "name": "nested-hive",
            "architect": seat,
            "operator": {"provider": op_ident.provider, "model": op_ident.model},
            "captains": captain_recs,
            "cross_talk": cross_talk,
            "board": True,
            "max_depth": max_depth,
            "max_children_per_agent": max_children,
            "max_agents": max_agents,
            "communication": communication,
            "task": task.strip(),
        }
    else:
        spec_out = _as_dict(spec)
        spec_out.setdefault("task", task.strip())

    result: dict[str, Any] = {
        "pattern": "hive",
        "run_id": run_id,
        "board_path": board_path,
        "spec": spec_out,
        "agents": agents,
        "tree": tree,
        "posts_seeded": posts_seeded,
        "dry_run": bool(dry_run),
        "task": task.strip(),
    }
    if spawned:
        result["spawned"] = spawned
    return result


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="fusion_swarm.hive",
        description="Nested hive orchestrator. Always prefer --dry-run first.",
    )
    ap.add_argument("task", nargs="?", default="", help="the hive goal")
    ap.add_argument("--task-file", dest="task_file", default=None)
    ap.add_argument("--spec-file", dest="spec_file", default=None)
    ap.add_argument("--spec", dest="spec_file", default=None,
                    help="alias of --spec-file (SwarmSpec JSON)")
    ap.add_argument("--architect", default="fable",
                    help="fable | astra | codex")
    ap.add_argument("--children", dest="children_per_captain",
                    type=int, default=4)
    ap.add_argument("--children-per-captain", dest="children_per_captain",
                    type=int, default=4)
    ap.add_argument("--captains", default=None,
                    help="csv of captain tokens (muse,glm,...)")
    ap.add_argument("--dry-run", dest="dry_run", action="store_true")
    ap.add_argument("--timeout", type=int, default=None)
    ap.add_argument("--state-dir", dest="state_dir", default=None)
    ap.add_argument("--json", action="store_true",
                    help="print the result dict as JSON (default: JSON anyway)")
    return ap


def _pretty(res: dict[str, Any], file=None) -> None:
    def out(msg: str) -> None:
        print(msg, file=file if file is not None else sys.stderr)
    out(f"=== fusion hive: {res.get('run_id')} ===")
    if res.get("design"):
        out("(design packet — no board yet; architect must emit SwarmSpec JSON)")
        out(f"task: {res.get('task')}")
        return
    out(f"board: {res.get('board_path')}")
    out(f"dry_run: {res.get('dry_run')}")
    agents = res.get("agents") or []
    out(f"agents: {len(agents)}")
    tree = res.get("tree") or {}
    children = tree.get("children") or {}
    for root in tree.get("roots") or []:
        out(f"  {root.get('id')} [{root.get('role')}] {root.get('provider')}/{root.get('model')}")
        for cap in children.get(root.get("id"), []):
            out(f"    {cap.get('id')} [{cap.get('role')}] {cap.get('provider')}/{cap.get('model')}")
            for kid in children.get(cap.get("id"), []):
                out(f"      {kid.get('id')} [{kid.get('role')}] {kid.get('provider')}/{kid.get('model')}")
    posts = res.get("posts_seeded") or []
    out(f"posts_seeded: {len(posts)}")


def main(argv: Optional[list[str]] = None) -> int:
    ap = build_parser()
    args = ap.parse_args(argv)
    task = args.task
    if args.task_file:
        with open(args.task_file, encoding="utf-8") as fh:
            task = fh.read().strip()
    if not task:
        ap.error("a task is required (positional or --task-file)")
    try:
        res = run(
            task,
            spec_file=args.spec_file,
            architect=args.architect,
            children_per_captain=args.children_per_captain,
            captains=args.captains,
            dry_run=args.dry_run,
            timeout=args.timeout,
            state_dir=args.state_dir,
        )
    except HiveError as ex:
        print(json.dumps({"ok": False, "error": str(ex)}, ensure_ascii=False))
        return 1
    # Always emit JSON on stdout so swarm.sh hive --dry-run is machine-readable.
    if not args.json:
        _pretty(res, file=sys.stderr)
    print(json.dumps(res, ensure_ascii=False, default=str, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
