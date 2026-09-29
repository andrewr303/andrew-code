"""python/fusion_swarm/config_store.py — safe read/write for config/defaults.env.

config/defaults.env is a fully-commented documentation file: every line is
`# export FUSION_X="default"` and uncommenting a line is how a user overrides
it. The file's comments also carry the precedence contract (explicit env >
defaults.env > plugin config > baked default) documented at its top. A naive
"regenerate the file" writer would destroy that contract. This module instead:

  - treats the set of FUSION_* keys already present in the file as a hard
    allowlist — it can uncomment/edit those lines, never invent new ones;
  - edits exactly one line per write, preserving every other byte (including
    line endings — Windows CRLF vs LF — so bash sourcing never breaks);
  - writes atomically (temp file + os.replace) after a timestamped backup;
  - reports, per key, which layer of the precedence chain currently supplies
    the effective value (explicit env / defaults.env / baked default), and
    flags that a plugin-config override (`/plugin -> configure -> fusion`) is
    a real possible layer this module cannot inspect from the filesystem —
    so a dashboard never claims false certainty about "why didn't my edit do
    anything".
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Optional

FUSION_ROOT = Path(__file__).resolve().parents[2]
DEFAULTS_ENV = FUSION_ROOT / "config" / "defaults.env"
BACKUP_DIR = FUSION_ROOT / "config" / ".backups"

_LINE_RE = re.compile(
    r'^(?P<indent>[ \t]*)(?P<hash>#\s*)?export\s+(?P<key>FUSION_[A-Z0-9_]+)='
    r'"(?P<value>[^"]*)"(?P<tail>.*)$'
)

PLUGIN_CONFIG_CAVEAT = (
    "This file is one layer of the precedence chain (explicit env > "
    "defaults.env > plugin config > baked default). `/plugin -> configure -> "
    "fusion` can set values in a layer this reader cannot inspect from the "
    "filesystem — if an edit here appears to have no effect, check for a "
    "plugin-config override or an explicit shell-exported FUSION_* var."
)


class ConfigError(Exception):
    pass


def _read_raw() -> str:
    # newline="" disables universal-newline translation so whatever line
    # endings are already in the file (LF or CRLF) come back byte-identical.
    return DEFAULTS_ENV.read_text(encoding="utf-8", newline="")


def parse_defaults() -> dict:
    """Return {key: {"value": str, "commented": bool, "line_no": int}} for
    every FUSION_* line found in defaults.env — this set IS the hard
    allowlist of keys the dashboard may edit."""
    raw = _read_raw()
    out: dict = {}
    for i, line in enumerate(raw.splitlines()):
        m = _LINE_RE.match(line)
        if not m:
            continue
        key = m.group("key")
        out[key] = {
            "value": m.group("value"),
            "commented": m.group("hash") is not None,
            "line_no": i,
        }
    return out


def list_keys() -> list[str]:
    return sorted(parse_defaults().keys())


_SHELL_DEFAULT_RE = re.compile(r'^\$\{(?P<inner_key>[A-Z0-9_]+):-(?P<default>.*)\}$')


def _resolve_display_value(key: str, raw_value: str) -> tuple[str, bool]:
    """A few active (uncommented) lines use the self-referential shell idiom
    `export FUSION_X="${FUSION_X:-default}"` so sourcing the file never
    clobbers an already-exported var. The raw quoted text in that case is a
    shell expression, not the effective value — unwrap it to the literal
    default. Returns (display_value, was_shell_expr)."""
    m = _SHELL_DEFAULT_RE.match(raw_value)
    if m and m.group("inner_key") == key:
        return m.group("default"), True
    return raw_value, False


def effective_value(key: str) -> dict:
    """Resolve the effective value for one FUSION_* key across the layers
    this process can actually see: explicit env, then defaults.env (only if
    uncommented — a commented line is documentation of the baked default, not
    an active override), else 'baked default (not in an inspectable layer)'."""
    if key in os.environ:
        return {"key": key, "value": os.environ[key], "source": "env",
                "caveat": None}
    parsed = parse_defaults().get(key)
    if parsed and not parsed["commented"]:
        display, is_expr = _resolve_display_value(key, parsed["value"])
        source = "defaults.env (baked default via ${VAR:-default})" if is_expr else "defaults.env"
        return {"key": key, "value": display, "source": source,
                "caveat": PLUGIN_CONFIG_CAVEAT}
    if parsed and parsed["commented"]:
        display, _ = _resolve_display_value(key, parsed["value"])
        return {"key": key, "value": display, "source": "baked_default",
                "caveat": PLUGIN_CONFIG_CAVEAT}
    return {"key": key, "value": None, "source": "unknown", "caveat": PLUGIN_CONFIG_CAVEAT}


def all_effective() -> list[dict]:
    return [effective_value(k) for k in list_keys()]


def _backup() -> Path:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest = BACKUP_DIR / f"defaults.env.{stamp}.bak"
    dest.write_text(_read_raw(), encoding="utf-8", newline="")
    return dest


def set_value(key: str, value: str) -> dict:
    """Surgically uncomment/edit every line for `key`, preserving every other
    byte of the file. defaults.env documents a couple of keys (e.g.
    FUSION_GROK_MODEL) on more than one line across sections — editing only
    the first would silently diverge from parse_defaults()/effective_value()
    (which read whichever occurrence appears last), so every occurrence is
    kept in sync. Raises ConfigError if `key` is not already a documented
    FUSION_* line in defaults.env (hard allowlist — this never invents a new
    config key) or if `value` contains a double-quote (the file's quoting
    scheme can't safely embed one without a rewrite this module intentionally
    does not attempt)."""
    if not re.fullmatch(r"FUSION_[A-Z0-9_]+", key):
        raise ConfigError(f"'{key}' is not a FUSION_* key")
    if '"' in value:
        raise ConfigError("value may not contain a double-quote character")

    raw = _read_raw()
    # Split preserving the original line terminator per line.
    lines = re.split(r"(\r\n|\r|\n)", raw)  # alternating content/terminator
    occurrences = 0
    for idx in range(0, len(lines), 2):
        line = lines[idx]
        m = _LINE_RE.match(line)
        if m and m.group("key") == key:
            # If this line used the self-referential `${KEY:-default}` idiom,
            # preserve it — writing a bare literal here would silently drop
            # that line's "an already-exported env var still wins when this
            # file is sourced" guarantee for a value that looks unchanged.
            _, was_expr = _resolve_display_value(key, m.group("value"))
            quoted = f"${{{key}:-{value}}}" if was_expr else value
            new_line = f'{m.group("indent")}export {key}="{quoted}"{m.group("tail")}'
            lines[idx] = new_line
            occurrences += 1
    if not occurrences:
        raise ConfigError(
            f"'{key}' is not a documented key in {DEFAULTS_ENV.name} — "
            "refusing to add a new, undocumented config line"
        )

    backup_path = _backup()
    new_raw = "".join(lines)
    tmp = DEFAULTS_ENV.with_suffix(".tmp")
    tmp.write_text(new_raw, encoding="utf-8", newline="")
    os.replace(tmp, DEFAULTS_ENV)
    return {"key": key, "value": value, "backup": str(backup_path), "lines_updated": occurrences}
