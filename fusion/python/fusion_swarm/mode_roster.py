"""python/fusion_swarm/mode_roster.py — server-side resolution of each
/fusion:<mode>'s roster with the EFFECTIVE model/effort it would actually run.

The Modes tab's truthfulness depends on resolving rosters HERE, in Python,
through the existing adapter / config_store / modes_catalog code paths — never
reconstructing precedence in the browser (CEO directive D3). For engine-backed
modes it reports the exact provider set the pattern dispatches (the t1 roster
contract) and, per provider, the winning model/effort and WHICH layer supplied
it (per-mode override key > global key > baked). Dynamic/prose modes report
resolution='dynamic' with the honest roster note. agy is emitted once with
sessions=2 and its correlation badge — never two independent votes.
"""
from __future__ import annotations

from typing import Optional

from . import adapter, config_store, modes_catalog


def _global_model_key(provider: str) -> str:
    return f"FUSION_{provider.upper()}_MODEL"


def _global_effort_key(provider: str) -> Optional[str]:
    # opencode's reasoning knob is --variant (FUSION_OPENCODE_VARIANT); grok/agy
    # have no honest effort knob (see modes_catalog.EFFORT_CAPABLE_PROVIDERS).
    if provider == "opencode":
        return "FUSION_OPENCODE_VARIANT"
    if provider in modes_catalog.EFFORT_CAPABLE_PROVIDERS:
        return f"FUSION_{provider.upper()}_EFFORT"
    return None


def _resolve_field(provider: str, pattern: str, field: str, allow: set) -> dict:
    """Resolve one (provider, field) to its effective value + provenance,
    mirroring adapter/bash precedence: active per-mode override > global (env >
    defaults.env > baked). `field` in {'MODEL','EFFORT'}."""
    override_key = adapter.mode_override_key(pattern, provider, field)
    has_override_key = override_key in allow  # only offered where a real key exists
    if has_override_key:
        ov = adapter._active_override(provider, pattern, field)
        if ov:
            return {"value": ov, "source": "per-mode override",
                    "override_key": override_key}
    if field == "MODEL":
        gk = _global_model_key(provider)
    else:
        gk = _global_effort_key(provider)
    if gk and gk in allow:
        eff = config_store.effective_value(gk)
        val = eff.get("value")
        if val:
            return {"value": val, "source": eff.get("source"),
                    "override_key": override_key if has_override_key else None}
    # last resort: adapter's baked model (effort has no universal baked default)
    baked = adapter.PROVIDER_META.get(provider, {}).get("model") if field == "MODEL" else None
    return {"value": baked, "source": "baked_default" if baked else "unset",
            "override_key": override_key if has_override_key else None}


def _provider_record(provider: str, pattern: str, allow: set) -> dict:
    meta = adapter.PROVIDER_META.get(provider, {})
    corr = None
    correlated_with: list[str] = []
    for group, members in adapter.CORRELATION_GROUPS.items():
        if provider in members:
            corr = group
            correlated_with = [m for m in members if m != provider]
    model = _resolve_field(provider, pattern, "MODEL", allow)
    rec = {
        "provider": provider,
        "role": adapter.tier_of(provider),
        "model_family": meta.get("model_family"),
        "harness": meta.get("harness"),
        "sessions": adapter.WORKER_SESSIONS.get(provider, 1),
        "correlation_group": corr,
        "correlated_with": correlated_with,
        "model": model["value"],
        "model_source": model["source"],
        "model_override_key": model["override_key"],
        "effort": None,
        "effort_source": None,
        "effort_override_key": None,
    }
    if provider in modes_catalog.EFFORT_CAPABLE_PROVIDERS:
        eff = _resolve_field(provider, pattern, "EFFORT", allow)
        rec["effort"] = eff["value"]
        rec["effort_source"] = eff["source"]
        rec["effort_override_key"] = eff["override_key"]
    return rec


def resolve_mode(entry: dict, allow: set) -> dict:
    """Resolve one modes_catalog entry into a roster record."""
    pattern = entry["engine_pattern"]
    providers = modes_catalog.engine_providers(pattern)
    base = {
        "mode": entry["mode"],
        "description": entry["description"],
        "engine_pattern": pattern,
        "invokes_skill": entry["invokes_skill"],
        "argument_hint": entry["argument_hint"],
    }
    if not providers:
        # dynamic / prose-decided / deterministic-gate: honest label, no votes.
        base.update({
            "resolution": "dynamic",
            "roster": [],
            "roster_note": entry.get("roster_note")
            or ("deterministic gate — dispatches no panelist" if pattern == "gate"
                else "decided at runtime by the invoked skill's prose"),
            "overridable": False,
        })
        return base
    base.update({
        "resolution": "engine",
        "roster": [_provider_record(p, pattern, allow) for p in providers],
        "overridable": pattern not in modes_catalog.PER_MODE_UNENFORCEABLE,
        "roster_note": (
            "roster shown from GLOBAL config; per-mode overrides for metaloop "
            "are orchestrated by the host skill and not set here"
            if pattern in modes_catalog.PER_MODE_UNENFORCEABLE else None),
    })
    return base


def resolve_modes() -> list[dict]:
    allow = set(config_store.parse_defaults().keys())
    return [resolve_mode(m, allow) for m in modes_catalog.all_modes()]
