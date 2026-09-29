"""Lightweight run ledger — learns which agents win which task types."""

from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Optional

from codefusion.paths import state_dir


def ledger_path() -> Path:
    p = state_dir() / "memory"
    p.mkdir(parents=True, exist_ok=True)
    return p / "runs.jsonl"


def record_run(entry: dict[str, Any]) -> None:
    entry = dict(entry)
    entry.setdefault("ts", time.time())
    entry.setdefault("product", "codefusion")
    path = ledger_path()
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(entry, ensure_ascii=False) + "\n")


def load_runs(limit: int = 500) -> list[dict[str, Any]]:
    path = ledger_path()
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    for line in lines[-limit:]:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


def winners(task_type: Optional[str] = None, limit: int = 20) -> list[tuple[str, int]]:
    counts: Counter[str] = Counter()
    for row in load_runs():
        if task_type and row.get("task_type") != task_type:
            continue
        w = row.get("winner")
        if isinstance(w, str) and w:
            counts[w] += 1
    return counts.most_common(limit)


def leaderboard(task_type: Optional[str] = None) -> dict[str, Any]:
    by_mode: dict[str, Counter[str]] = defaultdict(Counter)
    for row in load_runs():
        if task_type and row.get("task_type") != task_type:
            continue
        mode = str(row.get("mode") or "unknown")
        for p in row.get("panelists") or []:
            if isinstance(p, dict):
                prov = p.get("provider")
                st = p.get("status")
                if prov and st == "returned":
                    by_mode[mode][str(prov)] += 1
            elif isinstance(p, str):
                by_mode[mode][p] += 1
        w = row.get("winner")
        if isinstance(w, str) and w:
            by_mode[mode][w] += 1
    return {m: dict(c) for m, c in by_mode.items()}


def learn_summary() -> str:
    runs = load_runs()
    if not runs:
        return "Codefusion has no runs recorded yet. After a few panel/swarm runs, winners appear here."
    win = winners()
    board = leaderboard()
    lines = [
        f"Codefusion learnings · {len(runs)} runs",
        "",
        "Top winners:",
    ]
    if win:
        for name, n in win[:8]:
            lines.append(f"  {name}: {n}")
    else:
        lines.append("  (no explicit winners recorded)")
    lines.append("")
    lines.append("By mode:")
    for mode, counts in sorted(board.items()):
        top = ", ".join(f"{k}={v}" for k, v in sorted(counts.items(), key=lambda x: -x[1])[:5])
        lines.append(f"  {mode}: {top}")
    return "\n".join(lines)
