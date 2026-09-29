#!/usr/bin/env python3
"""Install Fusion as a Kimi Code / AndrewCode plugin.

Kimi/AndrewCode require ``kimi.plugin.json`` (or ``.kimi-plugin/plugin.json``)
and copy the plugin root into ``$ANDREWCODE_HOME/plugins/managed/<id>/``.
A naive recursive copy of this checkout would drag in vendor trees
(``kimi-code/``, ``andrewagent/``, ``cccc/``, …). This installer copies only
the plugin surface, then upserts ``plugins/installed.json``.

Stdlib only. No paid CLI calls. Idempotent.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

PLUGIN_ID = "fusion"

INCLUDE_DIRS = (
    "skills",
    "commands",
    "scripts",
    "python",
    "config",
    "memory",
    "docs",
    "assets",
    "tests",
    ".kimi-plugin",
    ".claude-plugin",
    ".codex-plugin",
)

INCLUDE_FILES = (
    "kimi.plugin.json",
    "plugin.json",
    "SYSTEM.md",
    "README.md",
    "INSTALL.md",
    "CODEX.md",
    "KIMI.md",
    "LICENSE",
    "install.sh",
    "install.ps1",
    "install.bat",
)

SKIP_DIR_NAMES = {
    "__pycache__",
    ".git",
    "node_modules",
    ".omc",
    ".repowise",
}


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _home() -> Path:
    env = (
        os.environ.get("ANDREWCODE_HOME")
        or os.environ.get("KIMI_CODE_HOME")
        or os.environ.get("KIMI_HOME")
        or ""
    ).strip()
    if env:
        return Path(env)
    return Path.home() / ".andrewcode"


def _copy_tree(src: Path, dest: Path) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    def ignore(directory: str, names: list[str]) -> set[str]:
        return {n for n in names if n in SKIP_DIR_NAMES}
    shutil.copytree(src, dest, ignore=ignore, dirs_exist_ok=False)


def install(plugin_root: Path, home: Path, *, dry_run: bool = False) -> Path:
    plugin_root = plugin_root.resolve()
    manifest = plugin_root / "kimi.plugin.json"
    if not manifest.is_file():
        raise SystemExit(f"missing {manifest} — Fusion is not a Kimi plugin yet")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    name = str(data.get("name") or "").strip()
    if name != PLUGIN_ID:
        raise SystemExit(f'kimi.plugin.json name must be "{PLUGIN_ID}" (got {name!r})')

    managed = home / "plugins" / "managed" / PLUGIN_ID
    installed_path = home / "plugins" / "installed.json"

    if dry_run:
        print(f"[dry-run] copy plugin surface -> {managed}")
        print(f"[dry-run] upsert {installed_path}")
        return managed

    managed.parent.mkdir(parents=True, exist_ok=True)
    staging = managed.parent / f"{PLUGIN_ID}-staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)

    for dirname in INCLUDE_DIRS:
        src = plugin_root / dirname
        if src.is_dir():
            _copy_tree(src, staging / dirname)
    for filename in INCLUDE_FILES:
        src = plugin_root / filename
        if src.is_file():
            shutil.copy2(src, staging / filename)

    if managed.exists():
        shutil.rmtree(managed)
    staging.rename(managed)

    record = {
        "id": PLUGIN_ID,
        "root": str(managed),
        "source": "local-path",
        "enabled": True,
        "installedAt": _now(),
        "updatedAt": _now(),
        "originalSource": str(plugin_root),
    }
    payload = {"version": 1, "plugins": []}
    if installed_path.is_file():
        try:
            payload = json.loads(installed_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            payload = {"version": 1, "plugins": []}
    if not isinstance(payload, dict):
        payload = {"version": 1, "plugins": []}
    plugins = list(payload.get("plugins") or [])
    now = _now()
    replaced = False
    out = []
    for entry in plugins:
        if isinstance(entry, dict) and entry.get("id") == PLUGIN_ID:
            entry = dict(entry)
            entry.update({
                "root": str(managed),
                "source": "local-path",
                "enabled": True,
                "updatedAt": now,
                "originalSource": str(plugin_root),
            })
            if "installedAt" not in entry:
                entry["installedAt"] = now
            out.append(entry)
            replaced = True
        else:
            out.append(entry)
    if not replaced:
        out.append(record)
    payload["version"] = 1
    payload["plugins"] = out
    installed_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = installed_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    tmp.replace(installed_path)
    print(f"installed Fusion -> {managed}")
    print(f"recorded in {installed_path}")
    print("reload: in AndrewCode / Kimi run  /plugins reload  then  /new")
    return managed


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Install Fusion for Kimi / AndrewCode")
    ap.add_argument("--root", default="", help="plugin source root (default: parent of scripts/)")
    ap.add_argument("--home", default="", help="ANDREWCODE_HOME / KIMI_CODE_HOME")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    root = Path(args.root) if args.root else Path(__file__).resolve().parents[1]
    home = Path(args.home) if args.home else _home()
    install(root, home, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
