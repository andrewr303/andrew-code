"""Verification Gate — a node that runs a real check (tests / typecheck / build /
lint) and emits pass/fail + logs.

This is the lever the council brainstorm calls out as missing: for code, a *hard*
gate (the test runner) should outrank any model vote. A judge model is soft; a
green test run is ground truth. Any structure can opt in by passing `gate_cmd`.

SAFETY: this executes a command. It is intended for NON-DESTRUCTIVE verification
(pytest / tsc --noEmit / npm run build / ruff / eslint). Structures default to
no gate (soft/confidence mode); a gate command is supplied explicitly by the
conductor, who owns the approval boundary.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

from .adapter import BASH


def detect_gate_command(cwd: str = ".") -> str | None:
    """Best-effort auto-detect of a verification command for a repo."""
    p = Path(cwd)
    pkg = p / "package.json"
    if pkg.exists():
        try:
            scripts = json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {})
        except Exception:
            scripts = {}
        if "typecheck" in scripts:
            return "npm run typecheck"
        if "test" in scripts:
            return "npm test --silent"
        if (p / "tsconfig.json").exists():
            return "npx --no-install tsc --noEmit"
        if "build" in scripts:
            return "npm run build"
    if (p / "tsconfig.json").exists():
        return "npx --no-install tsc --noEmit"
    if (
        (p / "pyproject.toml").exists()
        or (p / "pytest.ini").exists()
        or (p / "tests").exists()
        or list(p.glob("test_*.py"))
        or list(p.glob("*_test.py"))
    ):
        return "pytest -q"
    if (p / "Makefile").exists():
        return "make test"
    return None


def run_gate(command: str | None, cwd: str | None = None, timeout: int = 600) -> dict:
    """Run `command` and return {passed, returncode, command, log}. passed is None
    when no command (soft/skipped)."""
    if not command:
        return {"passed": None, "returncode": None, "command": None,
                "skipped": True, "log": "no gate command (soft mode)"}
    try:
        proc = subprocess.run(
            [BASH, "-lc", command],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        log = ((proc.stdout or "")[-2500:] + "\n" + (proc.stderr or "")[-2500:]).strip()
        return {
            "passed": proc.returncode == 0,
            "returncode": proc.returncode,
            "command": command,
            "log": log[-4000:],
        }
    except subprocess.TimeoutExpired:
        return {"passed": False, "returncode": 124, "command": command,
                "log": f"gate timed out after {timeout}s"}
    except Exception as e:  # noqa: BLE001
        return {"passed": False, "returncode": -1, "command": command, "log": str(e)}
