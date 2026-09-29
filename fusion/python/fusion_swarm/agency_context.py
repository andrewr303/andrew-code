"""Agency Context — centralized shared state across tools and agents.

Ported from Agency Swarm v1.x (``MasterContext``) and adapted for Fusion's
stdlib-only, subprocess-driven architecture. A MasterContext is a flat
dictionary store that any tool or agent can read from and write to — no direct
parameter passing between tools is needed.

Key patterns:
  - ``context.get("key")`` / ``context.set("key", value)`` — read/write
  - ``context.get("key", default)`` — safe reads with defaults
  - ``AgencyContext`` — context manager for scoped multi-step workflows
  - ``session_context`` — process-global singleton for back-compat
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field, asdict
from typing import Any, Optional


# ---------------------------------------------------------------------------
# MasterContext — the shared data store
# ---------------------------------------------------------------------------

@dataclass
class MasterContext:
    """Centralized data store accessible by all tools and agents within an
    agency. Every ``.get(key)`` / ``.set(key, value)`` operation reads/writes
    the underlying ``_data`` dictionary, which survives across tool calls
    without needing parameter passing.

    Usage (from a tool)::

        ctx: MasterContext = context_ref  # injected
        ctx.set("market_data", {"aapl": 150.0})
        data = ctx.get("market_data", {})
    """

    _data: dict[str, Any] = field(default_factory=dict)
    session_id: str = ""
    current_agent_name: str = ""
    shared_instructions: str = ""

    # Track per-step metadata for audit trails
    _agent_run_id: str | None = None
    _parent_run_id: str | None = None

    # ------------------------------------------------------------------
    # Core API — mirrors Agency Swarm's MasterContext.get()/.set()
    # ------------------------------------------------------------------

    def get(self, key: str, default: Any = None) -> Any:
        """Read a value from the context dictionary.

        Always provide a sensible default so callers do not need to
        guard against ``None`` returns::

            prefs = ctx.get("user_preferences", {})
            risk  = ctx.get("risk_tolerance", "moderate")
        """
        return self._data.get(key, default)

    def set(self, key: str, value: Any) -> None:
        """Store a value in the context dictionary.

        Any Python object can be stored — the context keeps a reference,
        not a serialised copy. For long-running sessions, clean up
        temporary keys to avoid unbounded growth::

            ctx.set("workflow_step_1", result)
        """
        self._data[key] = value

    def pop(self, key: str, default: Any = None) -> Any:
        """Remove and return a key (useful for one-shot data)."""
        return self._data.pop(key, default)

    def clear(self) -> None:
        """Drop the entire state — use at the end of a session."""
        self._data.clear()

    def keys(self) -> Any:   # actually dict_keys, but typing it requires extra imports
        return self._data.keys()

    def items(self) -> Any:
        return self._data.items()

    # ------------------------------------------------------------------
    # Bulk operations
    # ------------------------------------------------------------------

    def merge(self, incoming: dict[str, Any]) -> None:
        """Bulk-update the context (shallow merge)."""
        self._data.update(incoming)

    def snapshot(self) -> dict[str, Any]:
        """Return a shallow copy of the current context state."""
        return dict(self._data)

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict for persistence."""
        return {
            "data": self._data,
            "session_id": self.session_id,
            "current_agent_name": self.current_agent_name,
            "shared_instructions": self.shared_instructions,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "MasterContext":
        return cls(
            _data=d.get("data", {}),
            session_id=d.get("session_id", ""),
            current_agent_name=d.get("current_agent_name", ""),
            shared_instructions=d.get("shared_instructions", ""),
        )

    def __repr__(self) -> str:
        keys = ", ".join(sorted(self._data.keys())[:6])
        more = f" +{len(self._data) - 6}" if len(self._data) > 6 else ""
        return f"MasterContext({keys}{more})"

    def __contains__(self, key: str) -> bool:
        return key in self._data


# ---------------------------------------------------------------------------
# AgencyContext — scoped context manager
# ---------------------------------------------------------------------------

class AgencyContext:
    """Context manager that provides a MasterContext scoped to a block of work.

    Usage::

        with AgencyContext({"session_id": "abc123"}) as ctx:
            ctx.set("phase", "collect")
            do_work(ctx)
            # ctx is still alive — all sets persist
        # after the block: context is restored

    When nested, inner blocks see the parent context by default (so a
    supervisor's context is visible to worker blocks), but can also be
    created with ``inherit=False`` for full isolation.
    """

    _active: threading.local = threading.local()

    def __init__(
        self,
        initial: Optional[dict[str, Any]] = None,
        shared_instructions: str = "",
        inherit: bool = True,
    ) -> None:
        self._inherit = inherit
        self._previous: Optional[MasterContext] = None
        parent = getattr(AgencyContext._active, "master", None)
        initial = initial or {}
        if inherit and parent is not None:
            merged = dict(parent._data)
            merged.update(initial)
            self.master = MasterContext(
                _data=merged,
                session_id=parent.session_id,
                shared_instructions=shared_instructions or parent.shared_instructions,
            )
        else:
            self.master = MasterContext(
                _data=dict(initial),
                shared_instructions=shared_instructions,
            )

    def __enter__(self) -> MasterContext:
        self._previous = getattr(AgencyContext._active, "master", None)
        AgencyContext._active.master = self.master
        return self.master

    def __exit__(self, *a: Any) -> None:
        AgencyContext._active.master = self._previous

    @staticmethod
    def current() -> Optional[MasterContext]:
        """Return the currently-active MasterContext, or None."""
        return getattr(AgencyContext._active, "master", None)


# ---------------------------------------------------------------------------
# Session-level singleton — survives across tool calls within one process
# ---------------------------------------------------------------------------

_session_store: dict[str, MasterContext] = {}
_session_lock = threading.Lock()


def session_context(session_id: str) -> MasterContext:
    """Get or create a MasterContext for a named session. Sessions are
    process-global and survive across tool calls — the canonical way to share
    state between tools and agents in a long-running Fusion session::

        ctx = session_context("swarm-2024-07-11")
        ctx.set("customer_data", {...})
        # ... later, in another tool call:
        ctx = session_context("swarm-2024-07-11")
        data = ctx.get("customer_data")
    """
    with _session_lock:
        if session_id not in _session_store:
            _session_store[session_id] = MasterContext(session_id=session_id)
        return _session_store[session_id]


def drop_session(session_id: str) -> None:
    """Release a session's context (free memory)."""
    with _session_lock:
        _session_store.pop(session_id, None)


def list_sessions() -> list[str]:
    """Return active session IDs."""
    with _session_lock:
        return list(_session_store.keys())
