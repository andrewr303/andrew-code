"""Bridge to Fusion / Fusion-ML Python swarm patterns."""

from __future__ import annotations

import json
import os
from typing import Any, Optional

from codefusion.config import SWARM_PATTERNS, load_config
from codefusion.paths import FUSION_SWARM_PY, ensure_vendor_paths
from codefusion.ledger import record_run


def swarm_available() -> bool:
    ensure_vendor_paths()
    try:
        import fusion_swarm  # noqa: F401

        return True
    except ImportError:
        return (FUSION_SWARM_PY / "fusion_swarm").is_dir()


def run_pattern(
    pattern: str,
    task: str,
    *,
    providers: Optional[str] = None,
    timeout: Optional[int] = None,
    gate_cmd: str = "",
    extra: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Run a fusion_swarm pattern by name."""
    if pattern not in SWARM_PATTERNS:
        return {"ok": False, "error": f"unknown pattern '{pattern}'", "pattern": pattern}

    ensure_vendor_paths()
    cfg = load_config()
    # Align fusion host with codefusion host so host isn't double-invoked.
    os.environ.setdefault("FUSION_HOST", cfg.orchestrator_provider)
    os.environ.setdefault("FUSION_CODEX_MODEL", cfg.orchestrator_model)

    try:
        from fusion_swarm import (
            ballot,
            bestof,
            builder_breaker,
            discuss,
            flow,
            graph,
            heavy,
            hierarchical,
            ladder,
            moa,
            reasoning,
            refine,
            speclock,
        )
        from fusion_swarm import gate as gatemod
        from fusion_swarm import adapter as fusion_adapter
    except ImportError as exc:
        return {
            "ok": False,
            "error": f"fusion_swarm not importable: {exc}",
            "pattern": pattern,
            "hint": f"Expected package under {FUSION_SWARM_PY}",
        }

    extra = extra or {}
    timeout = timeout or cfg.panel_timeout_s
    prov_list = None
    if providers:
        prov_list = [p.strip() for p in providers.split(",") if p.strip()]

    try:
        if pattern == "moa":
            res = moa.run(
                task,
                layers=int(extra.get("layers", 2)),
                providers=prov_list,
                timeout=timeout,
            )
        elif pattern == "heavy":
            res = heavy.run(task, loops=int(extra.get("loops", 1)), providers=prov_list, timeout=timeout)
        elif pattern == "discuss":
            res = discuss.run(
                task, rounds=int(extra.get("rounds", 2)), providers=prov_list, timeout=timeout
            )
        elif pattern == "hierarchy":
            res = hierarchical.run(
                task,
                director=str(extra.get("director") or cfg.orchestrator_provider),
                providers=prov_list,
                timeout=timeout,
            )
        elif pattern == "graph":
            res = graph.run(
                task,
                nodes=extra.get("nodes"),
                edges=extra.get("edges"),
                timeout=timeout,
            )
        elif pattern == "flow":
            res = flow.run(task, flow_dsl=str(extra.get("flow") or ""), timeout=timeout)
        elif pattern == "refine":
            res = refine.run(
                task,
                generator=str(extra.get("generator") or cfg.orchestrator_provider),
                evaluator=str(extra.get("evaluator") or "grok"),
                threshold=int(extra.get("threshold", 80)),
                rounds=int(extra.get("rounds", 2)),
                timeout=timeout,
            )
        elif pattern == "bestof":
            res = bestof.run(
                task,
                provider=str(extra.get("provider") or "opencode"),
                samples=int(extra.get("samples", 5)),
                timeout=timeout,
            )
        elif pattern == "reflexion":
            res = reasoning.reflexion(
                task,
                provider=str(extra.get("provider") or cfg.orchestrator_provider),
                iterations=int(extra.get("iterations", 2)),
                timeout=timeout,
            )
        elif pattern == "selfconsist":
            res = reasoning.self_consistency(
                task,
                provider=str(extra.get("provider") or "copilot"),
                samples=int(extra.get("samples", 5)),
                timeout=timeout,
            )
        elif pattern == "gkp":
            res = reasoning.gkp(
                task,
                provider=str(extra.get("provider") or cfg.orchestrator_provider),
                timeout=timeout,
            )
        elif pattern == "ladder":
            res = ladder.run(task, gate_cmd=gate_cmd, providers=prov_list, timeout=timeout)
        elif pattern == "speclock":
            res = speclock.run(
                task,
                contract_author=str(extra.get("contract_author") or cfg.orchestrator_provider),
                providers=prov_list,
                gate_cmd=gate_cmd,
                timeout=timeout,
            )
        elif pattern == "breaker":
            res = builder_breaker.run(
                task,
                builder=str(extra.get("builder") or "opencode"),
                breaker=str(extra.get("breaker") or "grok"),
                gate_cmd=gate_cmd,
                timeout=timeout,
            )
        elif pattern == "ballot":
            res = ballot.run(task, providers=prov_list, gate_cmd=gate_cmd, timeout=timeout)
        elif pattern == "gate":
            res = gatemod.run(gate_cmd or task, cwd=extra.get("cwd"))
        else:
            return {"ok": False, "error": f"pattern '{pattern}' not wired", "pattern": pattern}
    except TypeError:
        # Some fusion_swarm APIs use slightly different signatures — fall back
        # to module __main__ style via subprocess is overkill; try call() shapes.
        try:
            mod = {
                "moa": moa,
                "heavy": heavy,
                "discuss": discuss,
            }.get(pattern)
            if mod and hasattr(mod, "run"):
                res = mod.run(task)  # type: ignore[misc]
            else:
                raise
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc), "pattern": pattern}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc), "pattern": pattern}

    if not isinstance(res, dict):
        res = {"result": res}
    res.setdefault("pattern", pattern)
    res.setdefault("product", "codefusion")
    res["ok"] = res.get("ok", True) if "error" not in res else False

    # Best-effort ledger
    try:
        panelists = []
        for item in res.get("transcript") or []:
            if isinstance(item, dict) and item.get("provider"):
                panelists.append(
                    {"provider": item["provider"], "status": item.get("status", "returned")}
                )
        record_run(
            {
                "run_id": f"swarm-{pattern}",
                "task_type": f"swarm:{pattern}",
                "mode": pattern,
                "judge": cfg.orchestrator_provider,
                "winner": res.get("winner") or res.get("winner_provider"),
                "panelists": panelists,
                "ok": res.get("ok"),
            }
        )
    except Exception:
        pass

    # Annotate live providers when helpful
    try:
        res.setdefault("available", fusion_adapter.available())
    except Exception:
        pass
    return res


def format_swarm_result(pattern: str, res: dict[str, Any]) -> str:
    lines = [f"✦ CODEFUSION swarm · {pattern}", ""]
    if res.get("error"):
        lines.append(f"error: {res['error']}")
        return "\n".join(lines)
    if pattern == "gate":
        lines.append(f"command: {res.get('command')}")
        lines.append(f"passed:  {res.get('passed')}  (rc={res.get('returncode')})")
        log = (res.get("log") or "")[-1500:]
        if log:
            lines.extend(["--- log (tail) ---", log])
        return "\n".join(lines)
    for key in ("winner", "winner_provider", "verdict", "answer", "synthesis", "final"):
        if res.get(key):
            lines.append(f"{key}: {res[key]}")
    if res.get("transcript"):
        lines.append(f"transcript steps: {len(res['transcript'])}")
    # Compact JSON dump for the rest
    skip = {"transcript", "log"}
    compact = {k: v for k, v in res.items() if k not in skip and not isinstance(v, (list, dict)) or k in {"status", "panel", "ok", "pattern"}}
    lines.append(json.dumps(compact, indent=2, default=str)[:3000])
    return "\n".join(lines)
