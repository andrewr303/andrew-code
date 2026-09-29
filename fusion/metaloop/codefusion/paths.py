"""Repo-relative path resolution for monorepo sources."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

PUPPETMASTER_ROOT = ROOT / "Puppetmaster-main"
FUSION_ROOT = ROOT / "fusion"
FUSION_ML_ROOT = ROOT / "fusion-ml"
CLAUDE_SUBAGENTS = ROOT / "awesome-claude-code-subagents-main"
CODEX_SUBAGENTS = ROOT / "awesome-codex-subagents-main"

# Bundled provider scripts (bash, used when Git Bash is available).
FUSION_PROVIDERS = FUSION_ML_ROOT / "scripts" / "providers"
if not FUSION_PROVIDERS.is_dir():
    FUSION_PROVIDERS = FUSION_ROOT / "scripts" / "providers"

FUSION_SWARM_PY = FUSION_ML_ROOT / "python"
if not (FUSION_SWARM_PY / "fusion_swarm").is_dir():
    FUSION_SWARM_PY = FUSION_ROOT / "python"


def ensure_vendor_paths() -> None:
    """Put monorepo vendor trees on sys.path (idempotent)."""
    for path in (
        PUPPETMASTER_ROOT,
        FUSION_SWARM_PY,
        FUSION_ML_ROOT / "python",
        FUSION_ROOT / "python",
    ):
        s = str(path)
        if path.is_dir() and s not in sys.path:
            sys.path.insert(0, s)


def state_dir() -> Path:
    """Per-user Codefusion state root."""
    import os

    override = os.environ.get("CODEFUSION_STATE_DIR")
    if override:
        return Path(override).expanduser()
    home = Path.home()
    # Prefer XDG on Unix; AppData-style on Windows.
    if sys.platform == "win32":
        base = Path(os.environ.get("LOCALAPPDATA", home / "AppData" / "Local"))
        return base / "codefusion"
    xdg = os.environ.get("XDG_STATE_HOME")
    if xdg:
        return Path(xdg) / "codefusion"
    return home / ".local" / "state" / "codefusion"


def project_state_dir(workspace: Path | None = None) -> Path:
    import hashlib

    ws = (workspace or Path.cwd()).resolve()
    digest = hashlib.sha256(str(ws).encode("utf-8")).hexdigest()[:12]
    name = ws.name.replace(" ", "-")[:40]
    d = state_dir() / "projects" / f"{name}-{digest}"
    d.mkdir(parents=True, exist_ok=True)
    return d
