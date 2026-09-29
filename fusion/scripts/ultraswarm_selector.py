#!/usr/bin/env python3
"""Interactive model selector for Fusion UltraSwarm.

The script uses only the Python standard library. It tries local CLI discovery
first, falls back to known defaults, then writes the user's selections and task
brief to ~/.fusion/ultraswarm/last_selection.json and .env.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Live discovery is delegated to the shared fusion_swarm.discovery module
# (python/fusion_swarm/discovery.py), which generalizes this script's
# original probe ladder (models --json -> models -> --list-models -> --help
# parse -> curated fallback) to all six Fusion providers, adds a persisted
# cache, and Windows-safe subprocess handling. This keeps exactly one
# implementation of "what models does this CLI actually have right now".
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "python"))
from fusion_swarm import discovery as _discovery  # noqa: E402


STATE = Path(os.environ.get("FUSION_STATE_DIR", str(Path.home() / ".fusion"))) / "ultraswarm"

# User-preferred easy defaults for Fusion UltraSwarm
OPENCODE_DEFAULT = "opencode-go/glm-5.2"
COPILOT_DEFAULT = "gemini-3.5-flash"

OPENCODE_FALLBACKS = [
    OPENCODE_DEFAULT,
    "opencode-go/deepseek-v4-pro",
    "opencode-go/deepseek-v4-flash",
    "opencode-go/kimi-k2.6",
    "opencode-go/minimax-m3",
]

COPILOT_FALLBACKS = [
    COPILOT_DEFAULT,
]


def discover(provider: str) -> tuple[list[str], str]:
    """Live-discover models for `provider` (opencode or copilot), delegating
    to the shared fusion_swarm.discovery module. Preserves this script's
    original (models, source) return shape and curated-fallback lists so
    every caller below (choose(), resolve_choice(), --discover) is unchanged."""
    fallbacks = OPENCODE_FALLBACKS if provider == "opencode" else COPILOT_FALLBACKS
    result = _discovery.discover(provider)
    models = result.get("models") or fallbacks
    status = result.get("status")
    source = result.get("source", "")
    if status == "live":
        return models, source
    # missing/degraded: the shared module already falls back to its own
    # curated list, but this script's fallback list is the one documented
    # here (kept in sync manually — both are the Fusion-curated defaults).
    return fallbacks, source or f"{provider} discovery inconclusive; showing Fusion defaults"


def choose(label: str, models: list[str], source: str) -> str:
    print()
    print(f"{label} models ({source})")
    print("-" * 72)
    for i, model in enumerate(models, 1):
        print(f"{i:>2}. {model}")
    while True:
        raw = input(f"Select {label} model [1-{len(models)}]: ").strip()
        try:
            idx = int(raw)
            if 1 <= idx <= len(models):
                return models[idx - 1]
        except Exception:
            pass
        print("Enter a number from the list.")


def write_outputs(opencode_model: str, copilot_model: str, task: str) -> Path:
    STATE.mkdir(parents=True, exist_ok=True)
    payload = {
        "created_at": int(time.time()),
        "agents": {
            "codex_host": {"model": "codex-host", "role": "orchestrator"},
            "codex_cli": {"model": "gpt-5.5", "effort": "xhigh", "optional": True},
            "grok": {"model": "grok build", "effort": "high"},
            "opencode": {"model": opencode_model, "variant": "high"},
            "copilot": {"model": copilot_model},
        },
        "task": task,
    }
    sel = STATE / "last_selection.json"
    env = STATE / "last_selection.env"
    task_file = STATE / "last_task.txt"
    sel.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    task_file.write_text(task + "\n", encoding="utf-8")
    env.write_text(
        "\n".join(
            [
                f'export FUSION_OPENCODE_MODEL="{opencode_model}"',
                'export FUSION_OPENCODE_VARIANT="high"',
                f'export FUSION_COPILOT_MODEL="{copilot_model}"',
                f'export FUSION_ULTRASWARM_SELECTION="{sel}"',
                f'export FUSION_ULTRASWARM_TASK_FILE="{task_file}"',
                "",
            ]
        ),
        encoding="utf-8",
    )
    return sel


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="UltraSwarm model selector (interactive or non-interactive)."
    )
    p.add_argument("--opencode", help="OpenCode model id or 1-based index or 'default'")
    p.add_argument("--copilot", help="Copilot model id or 1-based index or 'default'")
    p.add_argument("--task", help="Task/project description (skips prompt)")
    p.add_argument("--discover", action="store_true",
                   help="Only print discovered/fallback lists (JSON) and exit. No prompts, no writes.")
    p.add_argument("--non-interactive", action="store_true",
                   help="Force non-interactive mode (errors if required values missing).")
    return p.parse_args()


def resolve_choice(label: str, models: list[str], raw: str | None, default_idx: int = 0) -> str:
    if not raw:
        raw = "default"
    raw = raw.strip().lower()

    # "default" (user request) always means the curated easy default, not whatever
    # is first in the live discovery list.
    if raw in ("default", "d", ""):
        if label.lower().startswith("opencode"):
            return OPENCODE_DEFAULT
        return COPILOT_DEFAULT

    # 1-based index into whatever list we are showing
    try:
        idx = int(raw)
        if 1 <= idx <= len(models):
            return models[idx - 1]
    except Exception:
        pass

    # Exact / substring match against discovered list
    for m in models:
        if raw == m.lower() or raw in m.lower():
            return m

    # Final fallback
    print(f"[ultraswarm] Could not match {label} choice '{raw}', using curated default")
    if label.lower().startswith("opencode"):
        return OPENCODE_DEFAULT
    return COPILOT_DEFAULT


def main() -> int:
    args = parse_args()

    # Discovery-only mode (handy for the skill to present lists)
    if args.discover:
        oce, oce_src = discover("opencode")
        cop, cop_src = discover("copilot")
        print(json.dumps({
            "opencode": {"models": oce, "source": oce_src},
            "copilot": {"models": cop, "source": cop_src},
            "defaults": {
                "opencode": OPENCODE_DEFAULT,
                "copilot": COPILOT_DEFAULT,
            }
        }, indent=2))
        return 0

    print("Fusion UltraSwarm setup")
    print("Fixed agents: codex-host=judge, optional codex-cli=gpt-5.5 xhigh, grok=grok build high.")

    opencode_models, opencode_source = discover("opencode")
    copilot_models, copilot_source = discover("copilot")

    non_interactive = args.non_interactive or bool(args.opencode or args.copilot or args.task)

    if non_interactive:
        opencode_model = resolve_choice("OpenCode", opencode_models, args.opencode, 0)  # 0 = glm-5.2
        copilot_model = resolve_choice("Copilot", copilot_models, args.copilot, 0)      # 0 = gemini-3.5-flash
        task = (args.task or "").strip()
        if not task:
            print("[ultraswarm] --task is required in non-interactive mode", file=sys.stderr)
            return 2
    else:
        # Interactive (original behavior)
        opencode_model = choose("OpenCode", opencode_models, opencode_source)
        copilot_model = choose("Copilot", copilot_models, copilot_source)

        print()
        print("State the task/project for the five-agent council.")
        task = input("> ").strip()
        while not task:
            task = input("Task/project cannot be empty. Try again: ").strip()

    selection = write_outputs(opencode_model, copilot_model, task)
    env_file = selection.with_suffix(".env")

    print()
    print("UltraSwarm selection saved.")
    print(f"  OpenCode: {opencode_model}")
    print(f"  Copilot : {copilot_model}")
    print(f"Selection: {selection}")
    print(f"Env file : {env_file}")
    print()
    print("Next: ask Codex to use Fusion UltraSwarm (the task can be passed again or read from selection).")
    print(f'To use in shell:  source "{env_file}"')
    print()
    print("Council brief:")
    print(task)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
