"""Fusion MetaLoop — workspace strategy.

Preserves Fusion's safest invariant: external workers never write the user's
tree. Two modes are defined; only ``proposal`` is active in Phase 1.

  proposal (default, v1)
      Workers receive a context capsule and return structured artifacts
      (patch text, replacement files, tests, analysis). The GPT Chief Operator
      applies selected work in the real integration checkout and runs the gate.
      This reuses the existing adapter scratch-dir sandbox: nothing an external
      worker does touches the user's checkout.

  worktree (Phase 2, opt-in)
      One isolated git worktree per write-capable task. Not implemented here on
      purpose — calling it raises ``NotImplementedError`` so a caller can never
      *silently* fall back to an unsafe shared-checkout path.

The scope gate is available in both modes: after a worker returns, the set of
paths it claims to have changed is compared against ``allowed_paths`` /
``forbidden_paths``. A useful result that touched an unapproved path is NOT
auto-accepted — it is flagged for host review.
"""
from __future__ import annotations

import posixpath
from dataclasses import dataclass, field

from .contracts import TaskSpec

PROPOSAL = "proposal"
WORKTREE = "worktree"
WORKSPACE_MODES = (PROPOSAL, WORKTREE)


@dataclass
class ScopeReport:
    task_id: str
    ok: bool
    forbidden_hits: list[str] = field(default_factory=list)
    outside_allowed: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id, "ok": self.ok,
            "forbidden_hits": self.forbidden_hits,
            "outside_allowed": self.outside_allowed,
        }


def _norm(p: str) -> str:
    return posixpath.normpath(p.replace("\\", "/")).lstrip("./")


def _under(path: str, prefix: str) -> bool:
    """True if ``path`` is the prefix itself or lives under it (directory-aware,
    not a raw substring match: 'src/' does not match 'src-gen/')."""
    path, prefix = _norm(path), _norm(prefix)
    if prefix in ("", "."):
        return True
    return path == prefix or path.startswith(prefix + "/")


def scope_gate(task: TaskSpec, changed_paths: list[str]) -> ScopeReport:
    """Compare changed paths against the task's allow/forbid sets."""
    forbidden_hits: list[str] = []
    outside_allowed: list[str] = []
    for cp in changed_paths:
        if any(_under(cp, fp) for fp in task.forbidden_paths):
            forbidden_hits.append(cp)
            continue
        if task.allowed_paths and not any(_under(cp, ap) for ap in task.allowed_paths):
            outside_allowed.append(cp)
    ok = not forbidden_hits and not outside_allowed
    return ScopeReport(task.id, ok, forbidden_hits, outside_allowed)


class ProposalWorkspace:
    """Phase-1 default. No git operations; workers stay in adapter scratch dirs.
    The host applies proposals in the integration checkout itself."""

    mode = PROPOSAL

    def __init__(self, base_commit: str | None = None):
        self.base_commit = base_commit

    def prepare(self, task: TaskSpec) -> dict:
        """Return the per-task workspace descriptor handed to the dispatcher.
        Proposal mode has no per-task checkout — the worker only gets a capsule."""
        return {
            "mode": self.mode,
            "task_id": task.id,
            "base_commit": self.base_commit,
            "writable_checkout": None,
        }

    def cleanup(self, task: TaskSpec) -> None:  # nothing to clean in proposal mode
        return None


class WorktreeWorkspace:
    """Phase-2 placeholder. Intentionally inert so no caller can accidentally
    run multiple writers against one checkout before the isolation logic exists."""

    mode = WORKTREE

    def __init__(self, *_a, **_k):
        raise NotImplementedError(
            "worktree mode is Phase 2. Use workspace_mode='proposal' in Phase 1."
        )


def get_workspace(mode: str, base_commit: str | None = None):
    if mode == PROPOSAL:
        return ProposalWorkspace(base_commit=base_commit)
    if mode == WORKTREE:
        return WorktreeWorkspace(base_commit=base_commit)
    raise ValueError(f"unknown workspace mode '{mode}' (expected one of {WORKSPACE_MODES})")


__all__ = [
    "PROPOSAL", "WORKTREE", "WORKSPACE_MODES", "ScopeReport", "scope_gate",
    "ProposalWorkspace", "WorktreeWorkspace", "get_workspace",
]
