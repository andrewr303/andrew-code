"""Index and search bundled Claude Code + Codex subagent catalogs."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterator, Optional

from codefusion.paths import CLAUDE_SUBAGENTS, CODEX_SUBAGENTS


@dataclass
class Subagent:
    name: str
    family: str  # claude | codex
    category: str
    path: str
    description: str = ""
    tools: str = ""

    def dict(self) -> dict[str, Any]:
        return asdict(self)


def _parse_claude_md(path: Path) -> Optional[Subagent]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    name = path.stem
    desc = ""
    tools = ""
    # YAML frontmatter
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end != -1:
            fm = text[3:end]
            for line in fm.splitlines():
                if line.lower().startswith("name:"):
                    name = line.split(":", 1)[1].strip().strip("\"'")
                elif line.lower().startswith("description:"):
                    desc = line.split(":", 1)[1].strip().strip("\"'")
                elif line.lower().startswith("tools:"):
                    tools = line.split(":", 1)[1].strip()
    if not desc:
        for line in text.splitlines():
            s = line.strip()
            if s.startswith("#"):
                continue
            if s:
                desc = s[:200]
                break
    category = path.parent.name
    return Subagent(
        name=name,
        family="claude",
        category=category,
        path=str(path),
        description=desc,
        tools=tools,
    )


def _parse_codex_toml(path: Path) -> Optional[Subagent]:
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    name = path.stem
    desc = ""
    # naive key parse (no tomllib dependency for 3.9)
    m = re.search(r'(?m)^\s*name\s*=\s*["\']([^"\']+)["\']', text)
    if m:
        name = m.group(1)
    m = re.search(r'(?m)^\s*description\s*=\s*["\']([^"\']+)["\']', text)
    if m:
        desc = m.group(1)
    if not desc:
        m = re.search(r'(?m)^\s*description\s*=\s*"""(.*?)"""', text, re.S)
        if m:
            desc = " ".join(m.group(1).split())[:200]
    return Subagent(
        name=name,
        family="codex",
        category=path.parent.name,
        path=str(path),
        description=desc,
    )


def iter_subagents() -> Iterator[Subagent]:
    if CLAUDE_SUBAGENTS.is_dir():
        for path in sorted(CLAUDE_SUBAGENTS.glob("categories/**/*.md")):
            if path.name.upper() == "README.MD" or path.name == "README.md":
                continue
            agent = _parse_claude_md(path)
            if agent:
                yield agent
    if CODEX_SUBAGENTS.is_dir():
        for path in sorted(CODEX_SUBAGENTS.glob("categories/**/*.toml")):
            agent = _parse_codex_toml(path)
            if agent:
                yield agent


def list_subagents(
    *,
    family: Optional[str] = None,
    category: Optional[str] = None,
    query: Optional[str] = None,
    limit: int = 200,
) -> list[Subagent]:
    q = (query or "").lower()
    out: list[Subagent] = []
    for agent in iter_subagents():
        if family and agent.family != family:
            continue
        if category and category not in agent.category:
            continue
        if q:
            blob = f"{agent.name} {agent.description} {agent.category}".lower()
            if q not in blob:
                continue
        out.append(agent)
        if len(out) >= limit:
            break
    return out


def categories() -> dict[str, list[str]]:
    cats: dict[str, set[str]] = {"claude": set(), "codex": set()}
    for agent in iter_subagents():
        cats.setdefault(agent.family, set()).add(agent.category)
    return {k: sorted(v) for k, v in cats.items()}


def format_subagent_list(agents: list[Subagent]) -> str:
    if not agents:
        return "No subagents matched."
    lines = [f"Codefusion subagents · {len(agents)} shown", ""]
    for a in agents:
        lines.append(f"  [{a.family}] {a.category}/{a.name}")
        if a.description:
            lines.append(f"           {a.description[:120]}")
    return "\n".join(lines)


def load_subagent_prompt(name: str) -> Optional[str]:
    """Load full prompt body for injection into a worker."""
    for agent in iter_subagents():
        if agent.name == name or agent.name.lower() == name.lower():
            try:
                return Path(agent.path).read_text(encoding="utf-8", errors="replace")
            except OSError:
                return None
    return None
