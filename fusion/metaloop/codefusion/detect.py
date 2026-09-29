"""Detect installed coding-agent CLIs (tri-state: available | missing | degraded)."""

from __future__ import annotations

import json
import os
import shutil
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Optional

from codefusion.config import DEFAULT_ROSTER, load_config
from codefusion.paths import state_dir


@dataclass
class AgentStatus:
    provider: str
    bin: str
    status: str  # available | missing | degraded | host-native
    path: Optional[str]
    model: str
    role: str
    family: str
    strengths: list[str]

    def dict(self) -> dict[str, Any]:
        return asdict(self)


def _which(name: str) -> Optional[str]:
    # Windows: also try .cmd / .exe via shutil.which
    found = shutil.which(name)
    if found:
        return found
    if os.name == "nt":
        for ext in (".exe", ".cmd", ".bat", ".ps1"):
            found = shutil.which(name + ext)
            if found:
                return found
    return None


def _degraded_set() -> set[str]:
    path = state_dir() / "degraded-providers"
    if not path.is_file():
        return set()
    try:
        return {
            line.strip()
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.strip().startswith("#")
        }
    except OSError:
        return set()


def mark_degraded(provider: str) -> None:
    path = state_dir() / "degraded-providers"
    path.parent.mkdir(parents=True, exist_ok=True)
    current = _degraded_set()
    current.add(provider)
    path.write_text("\n".join(sorted(current)) + "\n", encoding="utf-8")


def clear_degraded(provider: Optional[str] = None) -> None:
    path = state_dir() / "degraded-providers"
    if provider is None:
        if path.exists():
            path.unlink()
        return
    remaining = _degraded_set() - {provider}
    if remaining:
        path.write_text("\n".join(sorted(remaining)) + "\n", encoding="utf-8")
    elif path.exists():
        path.unlink()


def detect_agents(
    *,
    host: Optional[str] = None,
    allowlist: Optional[list[str]] = None,
) -> list[AgentStatus]:
    cfg = load_config()
    host = host or cfg.orchestrator_provider
    allow = set(allowlist if allowlist is not None else cfg.allowlist)
    degraded = _degraded_set()
    out: list[AgentStatus] = []

    for entry in cfg.roster or DEFAULT_ROSTER:
        prov = str(entry["provider"])
        binary = str(entry.get("bin") or prov)
        if allow and prov not in allow:
            out.append(
                AgentStatus(
                    provider=prov,
                    bin=binary,
                    status="missing",
                    path=None,
                    model=str(entry.get("model") or ""),
                    role=str(entry.get("role") or ""),
                    family=str(entry.get("family") or ""),
                    strengths=list(entry.get("strengths") or []),
                )
            )
            continue

        if prov == host:
            path = _which(binary)
            out.append(
                AgentStatus(
                    provider=prov,
                    bin=binary,
                    status="host-native",
                    path=path,
                    model=str(entry.get("model") or ""),
                    role=str(entry.get("role") or ""),
                    family=str(entry.get("family") or ""),
                    strengths=list(entry.get("strengths") or []),
                )
            )
            continue

        path = _which(binary)
        if path is None:
            status = "missing"
        elif prov in degraded:
            status = "degraded"
        else:
            status = "available"

        out.append(
            AgentStatus(
                provider=prov,
                bin=binary,
                status=status,
                path=path,
                model=str(entry.get("model") or ""),
                role=str(entry.get("role") or ""),
                family=str(entry.get("family") or ""),
                strengths=list(entry.get("strengths") or []),
            )
        )
    return out


def live_panelists(*, include_host: bool = False, host: Optional[str] = None) -> list[AgentStatus]:
    agents = detect_agents(host=host)
    host = host or load_config().orchestrator_provider
    live = []
    for a in agents:
        if a.status == "available":
            live.append(a)
        elif include_host and a.status == "host-native" and a.provider == host:
            live.append(a)
    return live


def detect_report(*, as_json: bool = False) -> str:
    agents = detect_agents()
    live = [a for a in agents if a.status in {"available", "host-native"}]
    payload = {
        "product": "Codefusion",
        "orchestrator": load_config().orchestrator_model,
        "host": load_config().orchestrator_provider,
        "providers": {a.provider: a.status for a in agents},
        "agents": [a.dict() for a in agents],
        "live_count": sum(1 for a in agents if a.status == "available"),
        "multi_agent": sum(1 for a in agents if a.status == "available") >= 1,
    }
    if as_json:
        return json.dumps(payload, indent=2)

    lines = [
        "Codefusion · agent detection",
        f"  conductor : {payload['host']} / {payload['orchestrator']}",
        f"  live CLIs : {payload['live_count']} external + host",
        "",
    ]
    glyphs = {
        "available": "🟢",
        "host-native": "🔵",
        "degraded": "🟡",
        "missing": "⬛",
    }
    for a in agents:
        g = glyphs.get(a.status, "?")
        path = a.path or "—"
        lines.append(f"  {g} {a.provider:<10} {a.status:<12} {a.model or 'default':<28} {path}")
    lines.append("")
    if not any(a.status == "available" for a in agents):
        lines.append("  No external panelists found. Install codex/claude/grok/opencode/copilot/agy.")
    else:
        names = ", ".join(a.provider for a in live)
        lines.append(f"  Panel ready: {names}")
    return "\n".join(lines)
