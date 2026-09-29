"""python/fusion_swarm/modes_catalog.py — derive the "swarm config for every
variation" view from the actual command specs, not a hand-maintained list.

Every `/fusion:<mode>` command lives at commands/<mode>.md with a YAML
frontmatter block (description, argument-hint) and a body that names the
skill it invokes and — for modes backed by the Python engine — often the
provider roles it uses. This module parses that real source of truth so a
newly added command shows up automatically instead of requiring a second,
easily-stale place to hand-maintain the same information.

Where a command doesn't declare parseable roster/topology info (most of the
bash-skill-backed modes only name a skill, not a fixed roster — the skill
prose decides that dynamically), this reports that honestly instead of
inventing a topology that isn't actually in the spec.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Optional

FUSION_ROOT = Path(__file__).resolve().parents[2]
COMMANDS_DIR = FUSION_ROOT / "commands"

# Pattern names the Python engine (__main__.py) actually implements — a
# command whose body mentions one of these is backed by real, inspectable
# TaskSpec/roster code (adapter.py, moa.py, etc.), not just skill prose.
ENGINE_PATTERNS = {
    "moa", "heavy", "discuss", "hierarchy", "graph", "flow", "refine",
    "bestof", "reflexion", "selfconsist", "gkp", "ladder", "speclock",
    "breaker", "ballot", "gate", "metaloop", "kg",
}

PROVIDER_NAMES = ("codex", "copilot", "opencode", "grok", "agy", "fable")

# The base panel every panel-style pattern draws from (adapter.ALL_PANEL). A
# panel pattern dispatches `providers or available()`, so the set it CAN run is
# these four external CLIs; the Claude host is the off-panel judge/synthesizer.
BASE_PANEL = ("codex", "copilot", "opencode", "grok")

# Canonical engine-pattern -> provider roster contract. This is the single
# source of truth for "which providers does this pattern actually dispatch",
# traced from the real call sites in the pattern modules (moa/heavy/... call
# adapter.panel over the base panel; bestof is single-provider; ladder is
# tiered; breaker is builder+breaker; metaloop is the asymmetric roster; gate
# is a deterministic verification wrapper that dispatches no panelist). Both
# the per-mode override-key generator and /api/modes/resolved consume this so
# the dashboard can never show a roster the engine would not run. Patterns in
# ENGINE_PATTERNS with no entry here (e.g. selfconsist/gkp/hierarchy) have no
# command file mapping to them today and therefore generate nothing.
ENGINE_PATTERN_PROVIDERS = {
    "moa": BASE_PANEL,
    "heavy": BASE_PANEL,
    "discuss": BASE_PANEL,
    "hierarchy": BASE_PANEL,
    "graph": BASE_PANEL,
    "flow": BASE_PANEL,
    "ballot": BASE_PANEL,
    "reflexion": BASE_PANEL,
    "refine": BASE_PANEL,
    "speclock": BASE_PANEL,
    "bestof": ("codex",),
    "ladder": ("opencode", "codex"),
    "breaker": ("codex", "grok"),
    "gate": (),  # deterministic gate — dispatches no panelist
    "kg": (),    # knowledge-graph store ops — deterministic, dispatches no panelist
    "metaloop": ("codex", "grok", "opencode", "agy", "fable"),
}

_FRONTMATTER_RE = re.compile(r"^---\s*\n(?P<body>.*?)\n---\s*\n", re.DOTALL)
_FIELD_RE = re.compile(r'^(?P<key>[a-zA-Z_-]+):\s*(?P<value>.*)$')
_SKILL_RE = re.compile(r"\*\*([a-zA-Z0-9_-]+)\*\*\s+skill")
_ENGINE_CALL_RE = re.compile(
    r"swarm\.sh\s+(?P<pattern>[a-z_]+)|fusion_swarm\s+(?P<pattern2>[a-z_]+)"
)


def _parse_frontmatter(text: str) -> dict:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}
    out: dict = {}
    for line in m.group("body").splitlines():
        fm = _FIELD_RE.match(line)
        if fm:
            out[fm.group("key")] = fm.group("value").strip()
    return out


def _detect_skill(body: str) -> Optional[str]:
    m = _SKILL_RE.search(body)
    return m.group(1) if m else None


def _detect_engine_pattern(body: str) -> Optional[str]:
    """Return the first `swarm.sh <x>` / `fusion_swarm <x>` reference whose <x>
    is a real ENGINE_PATTERNS entry. Must scan ALL matches, not just the first:
    a command body legitimately mentions non-pattern subcommands (e.g.
    `swarm.sh roster` in commands/moa.md) BEFORE its own pattern, and a naive
    first-match `.search()` returned `roster` -> None, silently misclassifying
    the flagship `moa` mode as dynamic-roster."""
    for m in _ENGINE_CALL_RE.finditer(body):
        pat = m.group("pattern") or m.group("pattern2")
        if pat in ENGINE_PATTERNS:
            return pat
    return None


def engine_providers(pattern: Optional[str]) -> list[str]:
    """Providers the given engine pattern actually dispatches (its canonical
    roster). Empty list for dynamic/non-engine modes and for the deterministic
    `gate` pattern. This is the roster contract both the per-mode override-key
    generator and the resolved-roster endpoint build on."""
    if not pattern:
        return []
    return list(ENGINE_PATTERN_PROVIDERS.get(pattern, ()))


def _detect_providers(text: str) -> list[str]:
    low = text.lower()
    found = []
    for p in PROVIDER_NAMES:
        if re.search(rf"\b{p}\b", low):
            found.append(p)
    return found


def parse_command(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    fm = _parse_frontmatter(text)
    body = _FRONTMATTER_RE.sub("", text, count=1)
    engine_pattern = _detect_engine_pattern(text)
    entry = {
        "mode": path.stem,
        "description": fm.get("description"),
        "argument_hint": fm.get("argument-hint"),
        "invokes_skill": _detect_skill(body),
        "engine_pattern": engine_pattern,
        "providers_named_in_spec": _detect_providers(text),
        "roster_declared": bool(engine_pattern),
    }
    if not entry["roster_declared"]:
        entry["roster_note"] = (
            "not declared in command spec — this mode's live roster is "
            "decided dynamically by the skill it invokes, not a fixed "
            "TaskSpec/roster in the Python engine"
        )
    return entry


def all_modes() -> list[dict]:
    if not COMMANDS_DIR.is_dir():
        return []
    return sorted(
        (parse_command(p) for p in COMMANDS_DIR.glob("*.md")),
        key=lambda e: e["mode"],
    )


# Providers whose adapter actually CONSUMES a reasoning-effort argument, so a
# per-mode EFFORT override is a real knob rather than a misleading control:
#   codex   -> -c model_reasoning_effort=<effort>
#   opencode-> --variant <effort>
#   copilot -> --reasoning-effort <effort> (>=1.0.64, applied only when non-empty)
#   fable   -> FUSION_FABLE_EFFORT (advisor)
# Deliberately EXCLUDES grok (default grok model rejects effort — verified HTTP
# 400) and agy (effort is encoded in the model name, e.g. "... (High)"), so we
# never generate an EFFORT control the runtime would ignore or reject.
EFFORT_CAPABLE_PROVIDERS = ("codex", "opencode", "copilot", "fable")

# Engine patterns whose live dispatch does NOT flow through the Python engine's
# adapter.dispatch (and therefore cannot read a per-mode override key):
#   metaloop — the live roster is orchestrated by the host skill via bash
#   `fusion.sh dispatch` calls that pass each provider's GLOBAL model
#   explicitly, so a FUSION_METALOOP_<PROVIDER>_* key would be written but never
#   read. We refuse to generate a control that does nothing (honesty directive).
#   Its roster is still SHOWN, resolved from global config.
PER_MODE_UNENFORCEABLE = frozenset({"metaloop"})

_MODE_TOKEN_RE = re.compile(r"[^A-Za-z0-9]+")


def mode_token(mode: str) -> str:
    """Canonical env-key token for an invoked /fusion:<mode> name: uppercased,
    every maximal non-alphanumeric run collapsed to a single underscore. Keyed
    on the invoked command name (not the shared engine_pattern) so aliases that
    share a pattern remain independently configurable."""
    return _MODE_TOKEN_RE.sub("_", mode).strip("_").upper()


def per_mode_override_specs() -> list[dict]:
    """The bounded, canonical set of per-mode override keys, derived live from
    the command catalog + the engine roster contract. One MODEL key per
    (engine pattern x provider it dispatches), plus an EFFORT key only when that
    provider is effort-capable. This is the SINGLE source of truth consumed by
    both the defaults.env key generator/validator and the resolved-roster
    endpoint — there is no second, hand-maintained list to drift from.

    Keyed on the ENGINE PATTERN token, not the raw command name: the CLI
    dispatch boundary (`swarm.sh <pattern>`) is what the engine can actually
    resolve an override against, so the key the dashboard writes is exactly the
    key the engine reads (see adapter.resolve_model). For every engine command
    except `reason` the pattern equals the command name (FUSION_MOA_*,
    FUSION_HEAVY_*, ...); `reason` invokes the `reflexion` pattern, so its keys
    are FUSION_REFLEXION_* and the dashboard shows that mapping. `command`
    carries the representative /fusion:<mode> name for display.

    Returns dicts: {pattern, command, provider, field, key}, field in {MODEL, EFFORT}."""
    seen: dict[str, str] = {}  # pattern -> representative command (first by catalog order)
    for entry in all_modes():
        pat = entry["engine_pattern"]
        if not pat or pat in PER_MODE_UNENFORCEABLE or not engine_providers(pat):
            continue
        if pat not in seen:
            seen[pat] = entry["mode"]
    specs: list[dict] = []
    for pat, command in seen.items():
        ptok = pat.upper()
        for provider in engine_providers(pat):
            prov_up = provider.upper()
            specs.append({"pattern": pat, "command": command, "provider": provider,
                          "field": "MODEL", "key": f"FUSION_{ptok}_{prov_up}_MODEL"})
            if provider in EFFORT_CAPABLE_PROVIDERS:
                specs.append({"pattern": pat, "command": command, "provider": provider,
                              "field": "EFFORT", "key": f"FUSION_{ptok}_{prov_up}_EFFORT"})
    return specs


def per_mode_override_keys() -> list[str]:
    """Just the key names from per_mode_override_specs(), in catalog order."""
    return [s["key"] for s in per_mode_override_specs()]
