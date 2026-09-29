"""Swarm agent identities and spawn-limit gates.

Stdlib only. Fail-closed: unknown roles, empty ids, and out-of-range depths are
errors, never silently coerced. ``SpawnLimits.can_spawn`` is the official
pre-spawn gate used by ``spawn.py``; ``child()`` builds the child identity
(depth + 1, lineage append, parent spawn_budget decrement).
"""
from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass

ROLES = ("architect", "operator", "captain", "worker", "child")


class IdentityError(ValueError):
    """Raised when an identity is malformed or a child spawn is illegal."""


def _require_nonempty(name: str, value: object) -> str:
    if not isinstance(value, str) or value.strip() == "":
        raise IdentityError(f"{name} must be a non-empty string")
    return value


def new_id(prefix: str) -> str:
    """Return a unique ``{prefix}-{hex}`` id. Slashes in *prefix* are stripped
    so the id stays a single lineage segment."""
    raw = prefix if isinstance(prefix, str) and prefix.strip() else "agent"
    safe = raw.strip().replace("/", "-").replace(" ", "-")
    if not safe:
        safe = "agent"
    return f"{safe}-{uuid.uuid4().hex[:8]}"


def lineage_of(parent: AgentIdentity, child_id: str) -> str:
    """Slash path of ids, including the child (e.g. ``arch/muse/muse-2``)."""
    child_id = _require_nonempty("child_id", child_id)
    if "/" in child_id:
        raise IdentityError("child_id must not contain '/'")
    root = parent.lineage or parent.id
    return f"{root}/{child_id}"


@dataclass
class AgentIdentity:
    id: str
    display_name: str
    role: str          # architect | operator | captain | worker | child
    provider: str
    model: str
    parent_id: str | None = None
    lineage: str = ""  # slash path of ids, e.g. arch/muse/muse-2
    depth: int = 0
    spawn_budget: int = 0
    max_depth: int = 2
    status: str = "online"

    def __post_init__(self) -> None:
        self.id = _require_nonempty("id", self.id)
        if "/" in self.id:
            raise IdentityError("id must not contain '/'")
        self.display_name = _require_nonempty("display_name", self.display_name)
        self.role = _require_nonempty("role", self.role)
        if self.role not in ROLES:
            raise IdentityError(f"role must be one of {ROLES}")
        self.provider = _require_nonempty("provider", self.provider)
        self.model = _require_nonempty("model", self.model)
        if self.parent_id is not None:
            self.parent_id = _require_nonempty("parent_id", self.parent_id)
        if not isinstance(self.lineage, str):
            raise IdentityError("lineage must be a string")
        if not isinstance(self.depth, int) or isinstance(self.depth, bool) or self.depth < 0:
            raise IdentityError("depth must be an integer >= 0")
        if not isinstance(self.spawn_budget, int) or isinstance(self.spawn_budget, bool) or self.spawn_budget < 0:
            raise IdentityError("spawn_budget must be an integer >= 0")
        if not isinstance(self.max_depth, int) or isinstance(self.max_depth, bool) or self.max_depth < 0:
            raise IdentityError("max_depth must be an integer >= 0")
        self.status = _require_nonempty("status", self.status)
        if self.depth > self.max_depth:
            raise IdentityError(
                f"depth {self.depth} exceeds max_depth {self.max_depth}"
            )

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "AgentIdentity":
        if not isinstance(d, dict):
            raise IdentityError("input is not an object")
        known = set(cls.__dataclass_fields__)
        unknown = set(d) - known
        if unknown:
            raise IdentityError(f"unknown field(s): {sorted(unknown)}")
        return cls(**d)


def child(parent: AgentIdentity, **kwargs) -> AgentIdentity:
    """Build a child identity under *parent*.

    Increments depth, appends lineage, sets ``parent_id``, and decrements the
    conceptual parent's ``spawn_budget``. The child's ``spawn_budget`` defaults
    to 0 unless granted via kwargs. ``parent_id``, ``lineage``, and ``depth``
    are derived and cannot be passed in.
    """
    if not isinstance(parent, AgentIdentity):
        raise IdentityError("parent must be an AgentIdentity")
    if parent.depth >= parent.max_depth:
        raise IdentityError(
            f"cannot spawn: parent {parent.id} depth {parent.depth} "
            f">= max_depth {parent.max_depth}"
        )

    derived = ("parent_id", "lineage", "depth")
    blocked = [k for k in derived if k in kwargs]
    if blocked:
        raise IdentityError(
            f"{', '.join(blocked)} are derived and cannot be set on child()"
        )

    child_id = kwargs.pop("id", None) or new_id(parent.id)
    display_name = kwargs.pop("display_name", None) or child_id
    role = kwargs.pop("role", "child")
    provider = kwargs.pop("provider", parent.provider)
    model = kwargs.pop("model", parent.model)
    spawn_budget = kwargs.pop("spawn_budget", 0)
    max_depth = kwargs.pop("max_depth", parent.max_depth)
    status = kwargs.pop("status", "online")
    if kwargs:
        raise IdentityError(f"unknown field(s): {sorted(kwargs)}")

    identity = AgentIdentity(
        id=child_id,
        display_name=display_name,
        role=role,
        provider=provider,
        model=model,
        parent_id=parent.id,
        lineage=lineage_of(parent, child_id),
        depth=parent.depth + 1,
        spawn_budget=spawn_budget,
        max_depth=max_depth,
        status=status,
    )
    # Conceptual parent: remaining spawn slots drop by one (clamp at 0).
    parent.spawn_budget = max(0, parent.spawn_budget - 1)
    return identity


@dataclass
class SpawnLimits:
    max_depth: int = 2
    max_children_per_agent: int = 4
    max_agents: int = 24

    def __post_init__(self) -> None:
        for name in ("max_depth", "max_children_per_agent", "max_agents"):
            value = getattr(self, name)
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise IdentityError(f"{name} must be an integer >= 0")

    def can_spawn(
        self,
        parent: AgentIdentity,
        current_total: int,
        current_children: int,
    ) -> tuple[bool, str]:
        """Return ``(ok, reason)``. Reason is empty on success.

        Refuses when the parent is already at max depth, already has
        ``max_children_per_agent`` children, or the swarm is at ``max_agents``.
        """
        if not isinstance(parent, AgentIdentity):
            return False, "parent must be an AgentIdentity"
        if not isinstance(current_total, int) or isinstance(current_total, bool) or current_total < 0:
            return False, "current_total must be an integer >= 0"
        if not isinstance(current_children, int) or isinstance(current_children, bool) or current_children < 0:
            return False, "current_children must be an integer >= 0"

        cap = min(self.max_depth, parent.max_depth)
        if parent.depth >= cap:
            return (
                False,
                f"parent depth {parent.depth} >= max_depth {cap}",
            )
        if current_children >= self.max_children_per_agent:
            return (
                False,
                f"children {current_children} >= max_children_per_agent "
                f"{self.max_children_per_agent}",
            )
        if current_total >= self.max_agents:
            return (
                False,
                f"total {current_total} >= max_agents {self.max_agents}",
            )
        return True, ""
