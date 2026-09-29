"""scripts/dashboard_schema.py — the single declarative control schema.

The keystone of the dashboard config GUI. Maps EVERY allowlisted FUSION_* key
(config_store.parse_defaults() — global + per-mode) to a control descriptor:
widget type, group, label, help, enum choices, provider binding, and custom
policy. The dashboard HTML renders controls EXCLUSIVELY from this (served via
GET /api/schema); the server RE-VALIDATES every POST against the SAME schema
(validate_value). No enum list or model list is hardcoded in the HTML, and no
model inventory lives here either — model choices come only from live discovery.

Invariant (enforced by tests/test_dashboard_schema.py): the set of keys this
schema describes is EXACTLY the parse_defaults() allowlist — no surplus, none
missing — so a key can never render a control the writer would reject, nor be
writable without a control.

Stdlib-only; imports config_store + modes_catalog (both stdlib, no cycle).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FUSION_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FUSION_ROOT / "python"))

from fusion_swarm import config_store, modes_catalog  # noqa: E402

# --- enum vocabularies (the ONE place these live) ---------------------------
# Effort vocabularies differ by adapter. Every enum is custom-allowed (Fable's
# "Custom... escape hatch everywhere" directive), so these are suggestions, not
# a closed set — a value outside them is accepted and flagged 'custom'.
_EFFORT_CHOICES = {
    "codex": ["minimal", "low", "medium", "high", "xhigh"],   # model_reasoning_effort
    "opencode": ["low", "medium", "high"],                    # --variant
    "copilot": ["low", "medium", "high"],                     # --reasoning-effort
    "fable": ["low", "medium", "high", "xhigh"],              # claude effort
}
_SANDBOX_CHOICES = ["read-only", "workspace-write", "danger-full-access"]
_ADVISOR_POLICY = ["off", "on-demand", "auto", "always"]
_OPERATOR_POLICY = ["off", "always"]
_WORKSPACE_MODE = ["proposal", "worktree"]
_VARIANT_CHOICES = ["low", "medium", "high"]

# Provider display order for the Config tab groups.
_PROVIDER_ORDER = ["codex", "opencode", "grok", "copilot", "agy", "fable"]

_GROUP_LABELS = {
    "codex": "Codex (GPT — Chief Operator / base panel)",
    "opencode": "OpenCode (GLM subscription + direct-API)",
    "grok": "Grok (expert)",
    "copilot": "Copilot (base panel)",
    "agy": "Antigravity / Gemini (fast tier)",
    "fable": "Fable (Claude — MetaLoop CEO/advisor)",
    "metaloop": "MetaLoop policy & budgets",
    "snapshot": "Worker repo snapshot & prompts",
    "general": "General",
}


def _effort_descriptor(key: str, provider: str, group: str, label: str, mode=None, field=None) -> dict:
    if provider == "grok":
        # grok's default model rejects reasoningEffort (verified HTTP 400) — a
        # text control with a warning, never an enum implying it works.
        return {"key": key, "widget": "text", "group": group, "label": label,
                "help": "grok's default model REJECTS reasoning effort (HTTP 400). Leave empty.",
                "provider": provider, "choices": None, "unit": None,
                "custom_allowed": True, "mode": mode, "field": field}
    return {"key": key, "widget": "enum", "group": group, "label": label,
            "help": "Reasoning effort passed to this provider's adapter.",
            "provider": provider, "choices": _EFFORT_CHOICES.get(provider, ["low", "medium", "high"]),
            "unit": None, "custom_allowed": True, "mode": mode, "field": field}


def _model_descriptor(key: str, provider: str, group: str, label: str, help_: str, mode=None, field=None) -> dict:
    return {"key": key, "widget": "model", "group": group, "label": label,
            "help": help_, "provider": provider, "choices": None, "unit": None,
            "custom_allowed": True, "mode": mode, "field": field}


def _int_descriptor(key: str, group: str, label: str, unit: str, help_: str) -> dict:
    return {"key": key, "widget": "int", "group": group, "label": label,
            "help": help_, "provider": None, "choices": None, "unit": unit,
            "custom_allowed": False, "mode": None, "field": None}


_PROVIDER_OF_KEY = re.compile(r"^FUSION_(CODEX|OPENCODE|GROK|COPILOT|AGY|FABLE)_")


def _global_descriptor(key: str) -> dict:
    """Classify one GLOBAL FUSION_* key into a control descriptor."""
    m = _PROVIDER_OF_KEY.match(key)
    prov = m.group(1).lower() if m else None
    grp = prov if prov else ("metaloop" if key.startswith("FUSION_META_") else "snapshot")

    if key.endswith("_MODEL"):
        return _model_descriptor(key, prov, grp, f"{prov} model",
                                 f"Default model for {prov} across all modes (per-mode overrides win).")
    if key.endswith("_EFFORT"):
        return _effort_descriptor(key, prov, grp, f"{prov} effort")
    if key == "FUSION_OPENCODE_VARIANT":
        return {"key": key, "widget": "enum", "group": "opencode", "label": "opencode variant",
                "help": "OpenCode --variant (its reasoning-effort knob).",
                "provider": "opencode", "choices": _VARIANT_CHOICES, "unit": None,
                "custom_allowed": True, "mode": None, "field": None}
    if key == "FUSION_CODEX_SANDBOX":
        return {"key": key, "widget": "enum", "group": "codex", "label": "codex sandbox",
                "help": "Codex sandbox level.", "provider": "codex",
                "choices": _SANDBOX_CHOICES, "unit": None, "custom_allowed": True,
                "mode": None, "field": None}
    if key.endswith("_TIMEOUT"):
        return _int_descriptor(key, grp, key.replace("FUSION_", "").replace("_", " ").lower(),
                               "seconds", "Wall-clock timeout for this provider (seconds).")
    if key == "FUSION_META_ADVISOR_POLICY":
        return {"key": key, "widget": "enum", "group": "metaloop", "label": "advisor policy",
                "help": "When Fable (CEO) is consulted.", "provider": None,
                "choices": _ADVISOR_POLICY, "unit": None, "custom_allowed": True,
                "mode": None, "field": None}
    if key == "FUSION_META_OPERATOR_POLICY":
        return {"key": key, "widget": "enum", "group": "metaloop", "label": "operator policy",
                "help": "When the Chief Operator (codex) is dispatched.", "provider": None,
                "choices": _OPERATOR_POLICY, "unit": None, "custom_allowed": True,
                "mode": None, "field": None}
    if key == "FUSION_META_WORKSPACE_MODE":
        return {"key": key, "widget": "enum", "group": "metaloop", "label": "workspace mode",
                "help": "Worker workspace isolation.", "provider": None,
                "choices": _WORKSPACE_MODE, "unit": None, "custom_allowed": True,
                "mode": None, "field": None}
    if key == "FUSION_WORKER_REPO":
        return {"key": key, "widget": "text", "group": "snapshot", "label": "worker repo",
                "help": "Repo dir a worker snapshots (usually set per-dispatch).",
                "provider": None, "choices": None, "unit": None, "custom_allowed": True,
                "mode": None, "field": None}
    # remaining META_* budgets + SNAPSHOT_* + PROMPT_INLINE_MAX are integers
    unit = "count"
    if key == "FUSION_SNAPSHOT_MAX_FILES":
        unit = "files"
    elif key == "FUSION_SNAPSHOT_MAX_FILE_KB":
        unit = "KB"
    elif key == "FUSION_PROMPT_INLINE_MAX":
        unit = "chars"
    elif key == "FUSION_META_MAX_WALL_SECONDS":
        unit = "seconds"
    label = key.replace("FUSION_META_", "").replace("FUSION_", "").replace("_", " ").lower()
    return _int_descriptor(key, grp, label, unit, "Numeric budget/limit.")


def build_schema() -> list[dict]:
    """The full ordered schema: every allowlisted key -> control descriptor.
    Ordered global groups first (provider order, then metaloop/snapshot), then
    per-mode groups in catalog order."""
    allow = set(config_store.parse_defaults().keys())
    specs = modes_catalog.per_mode_override_specs()
    per_mode_keys = {s["key"] for s in specs}
    globals_ = sorted(allow - per_mode_keys)

    # sort globals by group order then name
    def gkey(k):
        d = _global_descriptor(k)
        try:
            gi = _PROVIDER_ORDER.index(d["group"])
        except ValueError:
            gi = len(_PROVIDER_ORDER) + (0 if d["group"] == "metaloop" else 1)
        return (gi, k)

    out = [_global_descriptor(k) for k in sorted(globals_, key=gkey)]

    for s in specs:
        grp = f"mode:{s['command']}"
        if s["field"] == "MODEL":
            out.append(_model_descriptor(
                s["key"], s["provider"], grp,
                f"{s['command']} · {s['provider']} model",
                f"Override the {s['provider']} model for /fusion:{s['command']} only.",
                mode=s["command"], field="MODEL"))
        else:  # EFFORT
            out.append(_effort_descriptor(
                s["key"], s["provider"], grp,
                f"{s['command']} · {s['provider']} effort",
                mode=s["command"], field="EFFORT"))
    return out


def schema_by_key() -> dict:
    return {d["key"]: d for d in build_schema()}


def group_order() -> list[dict]:
    """Ordered group descriptors for the UI: global provider/policy groups, then
    one collapsible group per engine mode with per-mode overrides."""
    groups: list[dict] = []
    seen = set()
    for d in build_schema():
        g = d["group"]
        if g in seen:
            continue
        seen.add(g)
        if g.startswith("mode:"):
            command = g.split(":", 1)[1]
            groups.append({"id": g, "kind": "mode", "command": command,
                           "label": f"/fusion:{command}"})
        else:
            groups.append({"id": g, "kind": "global",
                           "label": _GROUP_LABELS.get(g, g)})
    return groups


def validate_value(key: str, value: str) -> tuple[bool, str, bool]:
    """Server-side revalidation against the schema. Returns (ok, error, is_custom).
    Rejects keys absent from the schema and type-invalid ints/bools. Enum/model/
    text accept any (double-quote refusal stays config_store's job); a value
    outside an enum's suggested choices is accepted but flagged is_custom."""
    sch = schema_by_key()
    d = sch.get(key)
    if d is None:
        return (False, f"'{key}' is not a configurable key", False)
    v = value.strip()
    if d["widget"] == "int":
        if v == "":
            return (True, "", False)
        if not re.fullmatch(r"-?\d+", v):
            return (False, f"{key} must be an integer", False)
        return (True, "", False)
    if d["widget"] == "bool":
        if v.lower() not in ("", "0", "1", "true", "false"):
            return (False, f"{key} must be a boolean", False)
        return (True, "", False)
    # model / enum / text
    is_custom = bool(d.get("choices")) and v != "" and v not in d["choices"]
    return (True, "", is_custom)
