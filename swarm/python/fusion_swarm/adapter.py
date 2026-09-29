"""Fusion Python orchestration — the adapter backend.

Bridges the Python swarm patterns to Fusion's *verified* CLI adapters. Every
"agent call" is a subprocess to the same `scripts/providers/<prov>.sh` the rest
of Fusion uses, so all the injection-safety, portable-timeout, scratch-sandbox,
and exit-code logic is reused — no duplication, and no API keys (it rides the
already-authenticated CLIs: copilot/gemini, opencode/glm, grok, and optionally
codex/gpt-5.5 when FUSION_HOST is not codex).

Stdlib only — nothing to pip install. This is deliberately NOT the `swarms`
package: Fusion's panelists are CLI subprocesses, not LiteLLM model strings, so
we port the orchestration *patterns* (MoA layers, hierarchies, DAGs, group chat)
and run them over our own adapters.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

FUSION_ROOT = Path(__file__).resolve().parents[2]          # .../fusion
SCRIPTS = FUSION_ROOT / "scripts"
FUSION_SH = SCRIPTS / "fusion.sh"
DETECT_SH = SCRIPTS / "providers" / "detect.sh"
LEDGER_SH = SCRIPTS / "ledger.sh"

ALL_PANEL = ["codex", "copilot", "opencode", "grok", "andrewcode"]
FUSION_HOST = os.environ.get("FUSION_HOST", "codex")
# Legacy panel-style patterns (moa/heavy/discuss/flow) still fall back to the
# original four CLIs. Nested hive workers live on ALL_PANEL / hive, not here.
DEFAULT_PANEL = [p for p in ALL_PANEL if p != FUSION_HOST and p != "andrewcode"]

# Per-provider one-line capability hint, used by hierarchical/graph routing.
PROVIDER_STRENGTH = {
    "codex": "host-native by default; precise code, refactors, implementation when explicitly enabled",
    "copilot": "breadth, long-context reading, synthesis",
    "opencode": "high-volume drafts, boilerplate, speed",
    "grok": "realtime / web-current facts",
}

# --- MetaLoop provider metadata --------------------------------------------
# MetaLoop (fusion:metaloop) does NOT treat the roster as a flat panel. It
# separates an asymmetric advisor (Fable, the CEO) from tiered workers, and it
# must know each provider's model family + harness so correlated harnesses are
# never counted as independent votes. This metadata is the single source of
# truth for tier / family / harness across the Python engine and the ledger.
#
# Fast tier = TWO Antigravity (`agy`) sessions on Gemini 3.5 Flash. They are the
# same provider + model, so they are inherently ONE Gemini family (throughput /
# execution diversity, never two independent votes). Copilot is intentionally
# NOT a MetaLoop worker (it remains a base-panel panelist for other fusion modes).
WORKER_PROVIDERS = ["andrewcode", "agy", "opencode", "grok"]
ADVISOR_PROVIDERS = ["fable"]
# Chief Operator seat (dispatched when the in-context host is not Codex). Not a
# pool worker: it is called at fixed lifecycle points, never routed wave tasks.
OPERATOR_PROVIDERS = ["codex"]

# How many concurrent sessions each worker id may run in one wave. The fast tier
# runs two parallel `agy` sessions; experts run one session each. andrewcode is
# nested-hive capacity: a captain may spawn up to 4 child AndrewCode processes.
WORKER_SESSIONS = {"andrewcode": 4, "agy": 2, "opencode": 1, "grok": 1}

PROVIDER_META = {
    # Chief Operator seat. When the in-context host is NOT Codex (e.g. Claude
    # Code), codex is DISPATCHED at fixed lifecycle points (plan, adjudicate,
    # integration review) rather than sitting idle as a phantom host.
    "codex": {
        "tier": "operator", "model_family": "gpt", "harness": "codex-cli",
        "model": os.environ.get("FUSION_CODEX_MODEL", "gpt-5.6-sol"),
        "strengths": ["planning", "integration", "critical_path", "final_judgment",
                      "adjudication", "astra (gpt-6-astra) as optional architect/operator model"],
    },
    "andrewcode": {
        "tier": "expert", "model_family": "muse", "harness": "andrewcode-cli",
        "model": os.environ.get("FUSION_ANDREWCODE_MODEL", "meta/muse-spark-1.3-contributor"),
        "strengths": ["contributor_execution", "codebase_edits", "rapid_implementation",
                      "high_effort_reasoning"],
    },
    "grok": {
        "tier": "expert", "model_family": "grok", "harness": "grok-cli",
        "model": os.environ.get("FUSION_GROK_MODEL", "grok-4.5"),
        "strengths": ["novel_diagnosis", "current_context", "adversarial_review",
                      "alternative_architecture"],
    },
    "opencode": {
        "tier": "expert", "model_family": "glm", "harness": "opencode",
        "model": os.environ.get("FUSION_OPENCODE_MODEL", "opencode-go/glm-5.2"),
        "strengths": ["repo_scale", "complex_implementation", "broad_refactor",
                      "interface_mapping"],
    },
    "agy": {
        "tier": "fast", "model_family": "gemini", "harness": "antigravity-cli",
        "model": os.environ.get("FUSION_AGY_MODEL", "Gemini 3.5 Flash (High)"),
        "strengths": ["inventory", "mechanical_edit", "scaffolding", "batch",
                      "focused_edit", "tests", "docs"],
    },
    # Co-leader seat. Distinct model family (Moonshot), so its verdict is a
    # genuinely independent vote against gpt/gemini/glm panelists rather than a
    # correlated one. Reached via the Kimi Code CLI in one-shot prompt mode.
    "kimi": {
        "tier": "expert", "model_family": "kimi", "harness": "kimi-code-cli",
        "model": os.environ.get("FUSION_KIMI_MODEL", "azure/kimi-k3"),
        "strengths": ["frontend", "ui_implementation", "code_reading",
                      "integration_review", "adversarial_review"],
    },
    # Base-panel panelist only — NOT a MetaLoop worker (see WORKER_PROVIDERS).
    "copilot": {
        "tier": "fast", "model_family": "gemini", "harness": "github-copilot-cli",
        "model": os.environ.get("FUSION_COPILOT_MODEL", "gemini-3.5-flash"),
        "strengths": ["focused_edit", "tests", "docs", "diff_review"],
    },
    "fable": {
        "tier": "advisor", "model_family": "claude", "harness": "claude-code-print",
        "model": os.environ.get("FUSION_FABLE_MODEL", "fable-5.1"),
        "strengths": ["strategy", "risk", "decomposition", "taste", "main_planner"],
    },
}

# Providers whose outputs share a base model family and must not be counted as
# independent epistemic votes. The MetaLoop fast tier is two `agy` sessions on
# the SAME Gemini model, so they are one family by construction; a base panel
# that also runs Copilot (Gemini) stays correlated with agy too.
CORRELATION_GROUPS = {"gemini": ["agy", "copilot"]}


def model_family(provider: str) -> str:
    """Model family for a provider ('gemini', 'glm', 'grok', 'gpt', 'claude').
    Unknown providers map to their own name so they stay distinct."""
    return PROVIDER_META.get(provider, {}).get("model_family", provider)


def same_family(a: str, b: str) -> bool:
    """True if two providers share a model family (correlated, not independent)."""
    return model_family(a) == model_family(b)


def tier_of(provider: str) -> str:
    """Tier for a provider: operator | advisor | expert | fast. Unknown -> 'fast'."""
    return PROVIDER_META.get(provider, {}).get("tier", "fast")


# --- per-mode override resolution -------------------------------------------
# A /fusion:<mode> run can override a provider's model/effort independently of
# the global FUSION_<PROVIDER>_* config, via FUSION_<MODE>_<PROVIDER>_<FIELD>
# keys (see modes_catalog.per_mode_override_specs — pattern-keyed). The invoked
# mode is carried in a process-scoped env marker rather than a contextvar,
# because several patterns (discuss/flow/graph/heavy/hierarchy) dispatch inside
# their OWN ThreadPoolExecutors and a contextvar set on the main thread would
# not propagate into those worker threads. os.environ is process-global and
# thread-shared, so the marker reaches every dispatch with zero edits to the
# pattern modules. Resolution is deliberately additive: an override is applied
# ONLY when it is ACTIVE (a non-empty explicit env value or an uncommented
# defaults.env value); otherwise resolve_*() returns "" and dispatch falls
# through to the UNCHANGED bash global/baked resolution — preserving exact
# no-override baseline behavior.
INVOKED_MODE_ENV = "FUSION_INVOKED_MODE"

try:  # config_store is stdlib-only and does not import adapter (no cycle)
    from . import config_store as _config_store
except Exception:  # pragma: no cover - defensive
    _config_store = None

import re as _re

_MODE_TOKEN_OK = _re.compile(r"^[A-Za-z0-9_]+$")


def set_invoked_mode(mode: Optional[str]) -> None:
    """Record the invoked engine mode for this process so dispatch() can resolve
    per-mode overrides. Called once at the CLI pattern boundary (__main__)."""
    if mode and _MODE_TOKEN_OK.match(mode):
        os.environ[INVOKED_MODE_ENV] = mode
    else:
        os.environ.pop(INVOKED_MODE_ENV, None)


def _current_mode() -> Optional[str]:
    m = os.environ.get(INVOKED_MODE_ENV, "").strip()
    return m or None


def mode_override_key(mode: str, provider: str, field: str) -> str:
    """Build FUSION_<MODE>_<PROVIDER>_<FIELD>. `mode` is the engine-pattern
    token (what the dashboard writes and the engine reads — see modes_catalog)."""
    return f"FUSION_{mode.strip().upper()}_{provider.strip().upper()}_{field.strip().upper()}"


def _active_override(provider: str, mode: Optional[str], field: str) -> str:
    """Return a per-mode override value only if it is ACTIVE, else "". A
    commented/absent defaults.env line (source 'baked_default'/'unknown') is
    documentation of a NON-override and must not mask the global value."""
    if not mode or not _MODE_TOKEN_OK.match(mode) or provider not in PROVIDER_META:
        return ""
    key = mode_override_key(mode, provider, field)
    if _config_store is None:
        return os.environ.get(key, "").strip()
    try:
        info = _config_store.effective_value(key)
    except Exception:
        return os.environ.get(key, "").strip()
    src = info.get("source") or ""
    if src == "env" or src.startswith("defaults.env"):
        return (info.get("value") or "").strip()
    return ""


def resolve_model(provider: str, mode: Optional[str] = None) -> str:
    """Active per-mode MODEL override, else "" (defer to bash global/baked)."""
    return _active_override(provider, mode, "MODEL")


def resolve_effort(provider: str, mode: Optional[str] = None) -> str:
    """Active per-mode EFFORT override, else "" (defer to bash global/baked)."""
    return _active_override(provider, mode, "EFFORT")


@dataclass
class Reply:
    provider: str
    text: str
    status: str          # returned | absent | timeout | error
    ok: bool

    def dict(self) -> dict:
        return asdict(self)


def _find_bash() -> str:
    """Resolve GIT BASH explicitly. On Windows a bare 'bash' resolves to WSL
    (System32\\bash.exe), whose Linux PATH can't see the Windows CLIs — so we
    must pin Git Bash."""
    cand = os.environ.get("FUSION_BASH")
    if cand and Path(cand).exists():
        return cand
    for p in (
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files\Git\usr\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ):
        if Path(p).exists():
            return p
    w = shutil.which("bash")
    if w and "system32" not in w.lower():
        return w
    return "bash"


BASH = _find_bash()


def _fs(p) -> str:
    """Forward-slash a path so Git Bash handles it in redirections/args."""
    return str(p).replace("\\", "/")


def _bash(args: list[str], timeout: Optional[int] = None):
    proc = subprocess.run(
        [BASH, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    return proc.returncode, proc.stdout, proc.stderr


def available() -> list[str]:
    """Return the list of live external panelists (excludes the host judge)."""
    try:
        _, out, _ = _bash([_fs(DETECT_SH), "--json"])
        line = out.strip().splitlines()[-1]
        data = json.loads(line)
        provs = [
            p for p, s in data.get("providers", {}).items()
            if p not in {"claude", FUSION_HOST} and s == "available"
        ]
        return provs
    except Exception:
        return list(DEFAULT_PANEL)


def metaloop_availability() -> dict:
    """Availability for every MetaLoop participant, including agy (fast worker)
    and fable (advisor), which live under detect.sh's separate ``metaloop`` key
    so they never pollute the base panel. Returns {provider: bool}. Falls back to
    'unknown -> False' if detection can't be read."""
    status: dict[str, str] = {}
    try:
        _, out, _ = _bash([_fs(DETECT_SH), "--json"])
        data = json.loads(out.strip().splitlines()[-1])
        status.update(data.get("providers", {}))
        status.update(data.get("metaloop", {}))
    except Exception:
        pass
    # Operator (codex) included: "available" only when it is dispatchable —
    # detect.sh reports it "host-native" (-> False) when FUSION_HOST=codex.
    roster = OPERATOR_PROVIDERS + WORKER_PROVIDERS + ADVISOR_PROVIDERS
    return {p: (status.get(p) == "available") for p in roster}


def dispatch(
    provider: str,
    prompt: str,
    model: str = "",
    effort: str = "",
    timeout: Optional[int] = None,
    repo: str = "",
    mode: Optional[str] = None,
) -> Reply:
    """Run one panelist on `prompt` via its verified adapter. Never raises.

    ``repo`` is an optional repo directory a MetaLoop worker should snapshot for
    READ context (proposal mode). Empty ``repo`` keeps blind-panel behaviour.

    ``mode`` is the invoked engine mode; when None it is read from the
    process-scoped marker (works across pattern-spawned threads). An explicit
    non-empty ``model``/``effort`` from the caller always wins; otherwise an
    ACTIVE per-mode override is injected; otherwise both stay "" and the bash
    adapter resolves the global/baked value exactly as before."""
    eff_mode = mode if mode is not None else _current_mode()
    if eff_mode:
        if not model:
            model = resolve_model(provider, eff_mode)
        if not effort:
            effort = resolve_effort(provider, eff_mode)
    with tempfile.TemporaryDirectory(prefix="fusion-py-") as d:
        pf = Path(d) / "prompt.txt"
        of = Path(d) / "out.txt"
        pf.write_text(prompt, encoding="utf-8")
        try:
            rc, _, _ = _bash(
                [_fs(FUSION_SH), "dispatch", provider, _fs(pf), _fs(of),
                 model, effort, (_fs(repo) if repo else "")],
                timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return Reply(provider, "", "timeout", False)
        text = ""
        if of.exists():
            text = of.read_text(encoding="utf-8", errors="replace").strip()
        status = {0: "returned", 124: "timeout", 127: "absent"}.get(rc, "error")
        if status == "returned" and not text:
            status = "error"
        return Reply(provider, text, status, status == "returned")


def panel(
    prompt: str,
    providers: Optional[list[str]] = None,
    timeout: Optional[int] = None,
    mode: Optional[str] = None,
    **kw,
) -> list[Reply]:
    """Fan `prompt` out to all panelists concurrently (latency = slowest).

    The invoked mode is captured HERE (before fan-out) and passed explicitly to
    every threaded dispatch — belt-and-suspenders on top of the os.environ
    marker — so per-mode overrides resolve identically inside the executor."""
    provs = providers or available() or list(DEFAULT_PANEL)
    eff_mode = mode if mode is not None else _current_mode()
    out: list[Reply] = []
    with ThreadPoolExecutor(max_workers=max(1, len(provs))) as ex:
        futs = {
            ex.submit(dispatch, p, prompt, timeout=timeout, mode=eff_mode, **kw): p
            for p in provs
        }
        for f in as_completed(futs):
            out.append(f.result())
    order = {p: i for i, p in enumerate(DEFAULT_PANEL)}
    out.sort(key=lambda r: order.get(r.provider, 99))
    return out


def returning(replies: list[Reply]) -> list[Reply]:
    """Only panelists that actually returned a usable answer (absent != agreement)."""
    return [r for r in replies if r.ok and r.text.strip()]


def record_run(record: dict) -> None:
    """Append a run to Fusion's learning ledger (best-effort)."""
    try:
        _bash([_fs(LEDGER_SH), "record", json.dumps(record)])
    except Exception:
        pass
