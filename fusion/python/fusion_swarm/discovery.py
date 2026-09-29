"""python/fusion_swarm/discovery.py — live model discovery across all six
Fusion providers (codex, copilot, opencode, grok, agy, fable).

Generalizes scripts/ultraswarm_selector.py's probe ladder (`<cli> models
--json` -> `<cli> models` -> `<cli> --list-models` -> `<cli> --help` regex
parse -> curated fallback) so every provider — not just opencode/copilot —
gets the same live-discovery treatment. Consumed by both the localhost
dashboard (scripts/dashboard_server.py) and the swarm engine's `roster`
report, so there is exactly one implementation of "what models does this CLI
actually have right now".

Design constraints (from the MetaLoop CEO framing that authorized this
build):
  - Stdlib only, no new dependencies.
  - Every probe is read-only, non-interactive (stdin=DEVNULL, CI/NO_COLOR/
    TERM=dumb hints), hard-timed-out, and Windows-safe (process-tree kill via
    taskkill /T so a CLI that spawns a child on Windows can't survive a
    timeout as an orphan).
  - A hanging or erroring CLI resolves to "missing"/"degraded" + curated
    fallback — it must never block a caller for longer than PROBE_TIMEOUT *
    len(candidates) seconds, and callers needing a hard ceiling should pass
    force=False and rely on the cache.
  - Results are cached at ~/.fusion/model-cache.json (or $FUSION_STATE_DIR)
    with separate TTLs for success and degraded/missing (negative-cache), so
    a dashboard page load or a swarm run doesn't reshell every CLI every time.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

STATE_DIR = Path(os.environ.get("FUSION_STATE_DIR", str(Path.home() / ".fusion")))
CACHE_FILE = STATE_DIR / "model-cache.json"

SUCCESS_TTL = int(os.environ.get("FUSION_MODEL_CACHE_TTL", str(60 * 60)))       # 60 min
NEGATIVE_TTL = int(os.environ.get("FUSION_MODEL_CACHE_NEG_TTL", str(5 * 60)))   # 5 min
PROBE_TIMEOUT = int(os.environ.get("FUSION_DISCOVERY_PROBE_TIMEOUT", "10"))     # seconds/probe

MODEL_TOKEN = re.compile(
    r"(?<![\w.-])([A-Za-z0-9][A-Za-z0-9_.:/+-]{2,}(?:/[A-Za-z0-9_.:+-]+)?)(?![\w.-])"
)
_DENY_TOKENS = {
    "usage", "model", "models", "help", "true", "false", "json", "format",
    "command", "error", "version", "available", "options", "flags", "output",
    "the", "and", "for", "with", "logged", "default", "you", "are",
}
# Bare domains ("grok.com" from "logged in with grok.com") aren't model ids —
# only treat a dotted token as a model if it also carries a version digit
# (matches the opencode "provider/model-1.2" shape).
_DOMAIN_RE = re.compile(r"\.(com|org|net|io|ai|dev)$", re.I)

# One entry per Fusion provider. `binary` mirrors scripts/providers/detect.sh
# exactly (same command name it probes with `command -v`). `candidates` are
# read-only argv ladders tried in order; the first to return any text wins.
# `family_hint` narrows the --help regex-parse fallback to plausible model
# tokens. `curated` is the static list shown when nothing live works — this is
# expected and honest for CLIs with no non-interactive model-listing verb
# (agy, fable, and likely codex/grok), not a bug to "fix" by inventing output.
PROVIDER_PROBES = {
    "codex": {
        "binary": "codex",
        "candidates": [
            ["codex", "models", "--json"],
            ["codex", "models"],
            ["codex", "--list-models"],
            ["codex", "--help"],
        ],
        "family_hint": ("gpt", "o1", "o3", "o4", "sol", "codex"),
        "curated": ["gpt-5.6-sol", "gpt-5.5"],
    },
    "copilot": {
        "binary": "copilot",
        "candidates": [
            ["copilot", "models", "--json"],
            ["copilot", "models"],
            ["copilot", "--list-models"],
            ["copilot", "--help"],
        ],
        "family_hint": ("gpt", "claude", "gemini", "o1", "o3", "o4"),
        "curated": ["gemini-3.5-flash"],
    },
    "opencode": {
        "binary": "opencode",
        "candidates": [
            ["opencode", "models", "--json"],
            ["opencode", "models"],
            ["opencode", "list", "models"],
            ["opencode", "--help"],
        ],
        "family_hint": ("glm", "deepseek", "kimi", "minimax", "qwen", "claude", "gpt", "muse"),
        "slash_shape": True,
        "curated": [
            "opencode-go/glm-5.2",
            "opencode-go/deepseek-v4-pro",
            "opencode-go/deepseek-v4-flash",
            "opencode-go/kimi-k2.6",
            "opencode-go/minimax-m3",
        ],
    },
    "grok": {
        "binary": "grok",
        "candidates": [
            ["grok", "models", "--json"],
            ["grok", "models"],
            ["grok", "--list-models"],
            ["grok", "--help"],
        ],
        "family_hint": ("grok",),
        "curated": ["grok-4.5"],
    },
    "agy": {
        "binary": "agy",
        "candidates": [
            ["agy", "--list-models"],
            ["agy", "models"],
            ["agy", "--help"],
        ],
        "family_hint": ("gemini",),
        "curated": ["Gemini 3.5 Flash (High)", "Gemini 3.1 Pro (High)"],
    },
    # Fable rides the `claude` CLI (Claude Code print mode) — it is the CEO/
    # advisor seat, never a worker or vote. Discovery still reports what
    # Claude models are reachable so the dashboard can show it honestly, but
    # every consumer must keep fable out of worker/voter selection pools
    # (see adapter.PROVIDER_META["fable"]["tier"] == "advisor").
    "fable": {
        "binary": "claude",
        "candidates": [
            ["claude", "--list-models"],
            ["claude", "models"],
            ["claude", "--help"],
        ],
        "family_hint": ("claude", "opus", "sonnet", "haiku", "fable"),
        "curated": [
            "claude-fable-5", "claude-opus-4-8", "claude-sonnet-5",
            "claude-haiku-4-5-20251001",
        ],
    },
}

# OpenCode blends two billing families under one CLI: subscription models
# ride the "opencode-go/" namespace; anything else discovered is a direct-API
# model (e.g. a Meta Muse variant) and is key-dependent, not subscription-
# covered. Tag every discovered opencode model so consumers never mix them up.
def opencode_model_family(model: str) -> str:
    return "subscription" if model.lower().startswith("opencode-go/") else "direct-api"


def _probe_env() -> dict:
    env = dict(os.environ)
    env.update({"CI": "1", "NO_COLOR": "1", "TERM": "dumb", "PAGER": "cat", "GIT_PAGER": "cat"})
    return env


def _kill_tree(pid: int) -> None:
    """Best-effort process-tree kill. Windows CLIs can spawn helper children
    that a plain proc.kill() leaves orphaned holding a terminal/auth lock."""
    try:
        if os.name == "nt":
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(pid)],
                capture_output=True, timeout=5, check=False,
            )
        else:
            import signal
            os.killpg(os.getpgid(pid), signal.SIGKILL)
    except Exception:
        pass


def _run_probe(argv: list[str]) -> tuple[int, str]:
    """Run one read-only probe. Never raises. Returns (rc, text); rc=124 on
    timeout (tree-killed), rc=127 on spawn failure, rc=999 on other errors."""
    kwargs: dict = {}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=_probe_env(),
            **kwargs,
        )
    except FileNotFoundError:
        return 127, ""
    except OSError as exc:
        return 999, str(exc)
    try:
        out, _ = proc.communicate(timeout=PROBE_TIMEOUT)
        return proc.returncode if proc.returncode is not None else 999, out or ""
    except subprocess.TimeoutExpired:
        _kill_tree(proc.pid)
        try:
            out, _ = proc.communicate(timeout=2)
        except Exception:
            out = ""
        return 124, out or ""
    except Exception as exc:
        return 999, str(exc)


def _parse_json_models(text: str) -> list[str]:
    try:
        data = json.loads(text)
    except Exception:
        return []
    found: list[str] = []

    def walk(value):
        if isinstance(value, dict):
            mid = value.get("id") or value.get("model") or value.get("name")
            if isinstance(mid, str):
                found.append(mid)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(data)
    return found


def _parse_text_models(text: str, family_hint: tuple[str, ...], slash_shape: bool = False) -> list[str]:
    """Regex-scan free text (typically --help output) for plausible model
    names. `slash_shape` opts a provider into treating any "a/b" token as a
    model (OpenCode's "opencode-go/glm-5.2" namespacing) — everyone else's
    "/" tokens are far more often paths or URLs than model ids."""
    found: list[str] = []
    for token in MODEL_TOKEN.findall(text):
        clean = token.strip(".,;:()[]{}")
        low = clean.lower()
        if low in _DENY_TOKENS or len(clean) < 4:
            continue
        if "://" in clean or clean.endswith("/"):
            continue
        if _DOMAIN_RE.search(clean) and not any(c.isdigit() for c in clean):
            continue
        if slash_shape and "/" in clean:
            found.append(clean)
            continue
        # Real model ids in this ecosystem are consistently version-numbered
        # (gpt-5.6-sol, grok-4.5, glm-5.2, claude-fable-5). Requiring a digit
        # on family-hint matches keeps bare product-name mentions ("Codex",
        # "fable", "solely") out of --help-scraped results.
        if any(h in low for h in family_hint) and any(c.isdigit() for c in clean):
            found.append(clean)
    return found


_FAILURE_MARKERS = (
    "unexpected argument", "unknown option", "unrecognized",
    "no such subcommand", "not a valid subcommand", "invalid value",
)


def _looks_like_failure(text: str) -> bool:
    """True if a CLI's rc=0 output is actually a usage/error dump (some CLIs
    exit 0 even on 'unexpected argument' errors) rather than real data."""
    head = text.strip().splitlines()[:3]
    head_lower = " ".join(head).lower()
    if head_lower.startswith(("error:", "usage:")):
        return True
    return any(marker in head_lower for marker in _FAILURE_MARKERS)


def _unique(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        item = item.strip()
        if not item or item in seen:
            continue
        seen.add(item)
        out.append(item)
    return out


def _load_cache() -> dict:
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _save_cache(cache: dict) -> None:
    try:
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = CACHE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(cache, indent=2), encoding="utf-8")
        os.replace(tmp, CACHE_FILE)
    except Exception:
        pass  # cache is a pure optimization; never fail discovery over it


def _cache_fresh(entry: Optional[dict]) -> bool:
    if not entry:
        return False
    ttl = SUCCESS_TTL if entry.get("status") == "live" else NEGATIVE_TTL
    return (time.time() - entry.get("cached_at", 0)) < ttl


def discover(provider: str, force: bool = False) -> dict:
    """Live-discover models for one provider, honoring the cache unless
    force=True. Always returns a result — never raises, never blocks longer
    than PROBE_TIMEOUT * len(candidates) seconds."""
    spec = PROVIDER_PROBES.get(provider)
    if not spec:
        return {"provider": provider, "status": "unknown", "models": [],
                "source": "no probe spec for this provider", "cached_at": time.time(),
                "stale": False}

    cache = _load_cache()
    cached = cache.get(provider)
    if not force and _cache_fresh(cached):
        result = dict(cached)
        result["stale"] = False
        return result

    binary = spec["binary"]
    resolved = shutil.which(binary)
    if not resolved:
        result = {
            "provider": provider, "status": "missing", "models": list(spec["curated"]),
            "source": f"{binary} not on PATH — showing curated defaults",
            "cached_at": time.time(), "stale": False, "is_curated": True,
        }
        cache[provider] = result
        _save_cache(cache)
        return result

    collected: list[str] = []
    evidence = ""
    degraded = False
    for argv in spec["candidates"]:
        # Resolve argv[0] to the path shutil.which found (e.g. opencode.CMD on
        # Windows) — subprocess.Popen does not do PATHEXT resolution the way
        # cmd.exe's PATH search does, so the bare name alone can 127 even
        # though the binary is genuinely on PATH.
        rc, text = _run_probe([resolved, *argv[1:]])
        if rc == 124:
            degraded = True  # a candidate hung; keep trying the rest, but flag it
            continue
        if rc != 0:
            # Some CLIs (yargs-based subcommand help, clap "unexpected
            # argument") exit non-zero for a candidate flag they don't
            # support — never attribute a discovery to a failed candidate.
            continue
        # --help is expected to start with a "Usage:" banner; only reject
        # earlier candidates (models/--list-models) whose success we actually
        # need — those printing a usage/error dump mean the flag doesn't exist.
        is_help_candidate = argv[-1] in ("--help", "-h")
        if not is_help_candidate and _looks_like_failure(text):
            continue
        found = _parse_json_models(text) + _parse_text_models(
            text, spec["family_hint"], spec.get("slash_shape", False)
        )
        if found:
            collected.extend(found)
            evidence = " ".join(argv)  # only attribute to the candidate that actually produced models
            break

    models = _unique(collected)
    if models:
        status = "degraded" if degraded else "live"
        result = {
            "provider": provider, "status": status, "models": models,
            "source": f"discovered via `{evidence}`",
            "cached_at": time.time(), "stale": False, "is_curated": False,
        }
    else:
        # binary is on PATH but no probe yielded a model list -> curated fallback.
        # is_curated=True so consumers NEVER present these as live/selectable
        # (honesty: a discovery failure must offer only the custom escape hatch).
        result = {
            "provider": provider, "status": "degraded" if degraded else "missing",
            "models": list(spec["curated"]),
            "source": f"discovery returned no model list after `{evidence or binary}` — curated defaults",
            "cached_at": time.time(), "stale": False, "is_curated": True,
        }
    cache[provider] = result
    _save_cache(cache)
    return result


def discover_all(providers: Optional[list[str]] = None, force: bool = False) -> dict:
    """Discover models for every provider (or a given subset) concurrently.
    Returns {provider: result}. A slow/hanging provider never delays the
    others — each runs in its own thread with its own PROBE_TIMEOUT ceiling."""
    provs = providers or list(PROVIDER_PROBES.keys())
    out: dict = {}
    with ThreadPoolExecutor(max_workers=max(1, len(provs))) as ex:
        futs = {ex.submit(discover, p, force): p for p in provs}
        for fut in as_completed(futs):
            p = futs[fut]
            try:
                out[p] = fut.result()
            except Exception as exc:
                out[p] = {"provider": p, "status": "error", "models": [], "source": str(exc),
                          "cached_at": time.time(), "stale": False}
    # stable order
    return {p: out[p] for p in provs if p in out}


def cache_age_seconds(provider: str) -> Optional[float]:
    cache = _load_cache()
    entry = cache.get(provider)
    if not entry:
        return None
    return time.time() - entry.get("cached_at", 0)


def cached(provider: str) -> dict:
    """Cache-ONLY read for one provider — NEVER spawns a CLI probe. Used by the
    dashboard's initial page load so it can never block on discovery (Fable
    directive D6). A provider never probed returns status 'unprobed' with an
    empty model list; the UI then offers only the custom-entry escape hatch and
    an explicit Refresh, never a fabricated model list."""
    spec = PROVIDER_PROBES.get(provider)
    entry = _load_cache().get(provider)
    if entry:
        out = dict(entry)
        age = time.time() - entry.get("cached_at", 0)
        out["age_seconds"] = age
        ttl = SUCCESS_TTL if entry.get("status") == "live" else NEGATIVE_TTL
        out["stale"] = age >= ttl
        out["probed"] = True
        return out
    return {"provider": provider, "status": "unprobed", "models": [],
            "source": "not yet probed — Refresh to discover live models",
            "cached_at": None, "age_seconds": None, "stale": True, "probed": False,
            "is_curated": False, "curated_available": bool(spec and spec.get("curated"))}


def cached_all(providers: Optional[list[str]] = None) -> dict:
    """Cache-only report for every provider (or a subset). No probes, no blocking."""
    provs = providers or list(PROVIDER_PROBES.keys())
    return {p: cached(p) for p in provs}
