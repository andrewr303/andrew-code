"""Factory alias — discover/define/develop/deliver hive. Inspired by octopus Dark Factory."""
from __future__ import annotations

from typing import Any, Optional

from .designer import AgentSeat, CaptainSpec, SwarmSpec

# Four pipeline captains. Each may mint two nested andrewcode children.
PHASES: tuple[str, ...] = ("discover", "define", "develop", "deliver")

# Default seats. Captains may be any live CLI; children are always andrewcode.
_ARCHITECT = AgentSeat(provider="fable", model="fable-5.1")
_OPERATOR = AgentSeat(provider="codex", model="gpt-6-astra")

_CAPTAIN_SEATS: tuple[tuple[str, str, str], ...] = (
    ("discover", "grok", "grok-4.5"),
    ("define", "copilot", "gemini-3.5-flash"),
    ("develop", "opencode", "glm-5.3"),
    ("deliver", "andrewcode", "muse-spark-1.3"),
)

CHILDREN_PER_CAPTAIN = 2
# Architect fans out 4 captains; each captain's spawn=2 is still under this cap.
MAX_DEPTH = 2
MAX_CHILDREN_PER_AGENT = 4
MAX_AGENTS = 24


def factory_captains(*, spawn: int = CHILDREN_PER_CAPTAIN) -> list[CaptainSpec]:
    """Discover / define / develop / deliver captains, each spawning *spawn* children."""
    if not isinstance(spawn, int) or isinstance(spawn, bool) or spawn < 0:
        raise ValueError("spawn must be an integer >= 0")
    if spawn > MAX_CHILDREN_PER_AGENT:
        raise ValueError(
            f"spawn={spawn} exceeds max_children_per_agent={MAX_CHILDREN_PER_AGENT}"
        )
    return [
        CaptainSpec(
            id=ident,
            provider=provider,
            model=model,
            spawn=spawn,
            spawn_via="andrewcode",
        )
        for ident, provider, model in _CAPTAIN_SEATS
    ]


def factory_spec(task: str, *, spawn: int = CHILDREN_PER_CAPTAIN) -> SwarmSpec:
    """Fail-closed factory SwarmSpec: open board, 4D captains, nested andrewcode children."""
    if not isinstance(task, str) or not task.strip():
        raise ValueError("task must be a non-empty string")
    return SwarmSpec(
        name="factory",
        architect=_ARCHITECT,
        operator=_OPERATOR,
        captains=factory_captains(spawn=spawn),
        cross_talk=True,
        board=True,
        max_depth=MAX_DEPTH,
        max_children_per_agent=MAX_CHILDREN_PER_AGENT,
        max_agents=MAX_AGENTS,
        budget={},
        communication="open",
        task=task,
        notes=(
            "Factory alias of nested-hive: discover → define → develop → deliver. "
            "Each captain may spawn two andrewcode children. Open Hive Board; "
            "cross-talk allowed. Nested workers never address the human."
        ),
    )


def _spec_payload(spec: Any) -> Any:
    if spec is None:
        return None
    if hasattr(spec, "to_dict") and callable(spec.to_dict):
        return spec.to_dict()
    return spec


def run(
    task: str,
    dry_run: bool = False,
    timeout: Optional[int] = None,
    state_dir: Optional[str] = None,
    spec: Optional[Any] = None,
    spec_file: Optional[str] = None,
    architect: str = "fable",
    captains: Any = None,
) -> dict[str, Any]:
    """Thin wrapper around ``hive.run`` with the factory SwarmSpec.

    ``dry_run=True`` still builds the tree and seeds the board; it does not
    subprocess. Live path is real dispatch only — this module never fakes a CLI.
    """
    from . import hive

    if spec is None and spec_file is None:
        spec = factory_spec(task)

    # Do not pass children_per_captain: hive's default (4) means "keep spec
    # spawn". Each factory captain already declares spawn=2.
    kwargs: dict[str, Any] = dict(
        spec=spec,
        spec_file=spec_file,
        architect=architect,
        dry_run=dry_run,
        timeout=timeout,
        state_dir=state_dir,
    )
    if captains is not None:
        kwargs["captains"] = captains
    result = hive.run(task, **kwargs)

    if not isinstance(result, dict):
        raise TypeError("hive.run must return a dict")
    out = dict(result)
    out["pattern"] = "factory"
    payload = _spec_payload(spec)
    if payload is not None:
        out["spec"] = payload
    out["dry_run"] = bool(dry_run)
    return out
