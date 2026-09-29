"""Codefusion configuration and default roster."""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Optional

from codefusion.paths import state_dir

# Default conductor: GPT-5.6 via Codex (user-requested).
ORCHESTRATOR_MODEL = os.environ.get("CODEFUSION_ORCHESTRATOR_MODEL", "gpt-5.6")
ORCHESTRATOR_EFFORT = os.environ.get("CODEFUSION_ORCHESTRATOR_EFFORT", "xhigh")
ORCHESTRATOR_PROVIDER = os.environ.get("CODEFUSION_HOST", "codex")

# Primary architecture: Meta LOOP (see metaloop.py / diagram).
# Collaboration modes (Fusion + Fusion-ML + coding gates) remain available.
CORE_MODES = ("metaloop", "solo", "panel", "council", "debate", "vote", "swarm")
SWARM_PATTERNS = (
    "moa",
    "heavy",
    "discuss",
    "hierarchy",
    "graph",
    "flow",
    "refine",
    "bestof",
    "reflexion",
    "selfconsist",
    "gkp",
    "ladder",
    "speclock",
    "breaker",
    "ballot",
    "gate",
)

# Agent defaults — capability roles, not cost tiers.
DEFAULT_ROSTER: list[dict[str, Any]] = [
    {
        "provider": "codex",
        "family": "OpenAI",
        "model": ORCHESTRATOR_MODEL,
        "effort": ORCHESTRATOR_EFFORT,
        "role": "host conductor, judge, integrator, highest-risk implementation",
        "bin": "codex",
        "strengths": ["orchestration", "precise code", "refactors", "implementation"],
    },
    {
        "provider": "claude",
        "family": "Anthropic",
        "model": "claude-opus-4-8",
        "effort": "high",
        "role": "deep reasoning, long-horizon coding, careful review",
        "bin": "claude",
        "strengths": ["reasoning", "architecture", "careful edits", "review"],
    },
    {
        "provider": "grok",
        "family": "xAI",
        "model": "grok-build",
        "effort": "xhigh",
        "role": "adversarial review, realtime checks, edge cases",
        "bin": "grok",
        "strengths": ["adversarial", "realtime", "edge cases", "web-current"],
    },
    {
        "provider": "opencode",
        "family": "OpenCode / GLM",
        "model": "opencode-go/glm-5.2",
        "effort": "high",
        "role": "high-volume implementation drafts, boilerplate, alternatives",
        "bin": "opencode",
        "strengths": ["drafts", "boilerplate", "speed", "volume"],
    },
    {
        "provider": "agy",
        "family": "Google Antigravity",
        "model": "Gemini 3.1 Pro (High)",
        "effort": "high",
        "role": "broad codebase reasoning and planning",
        "bin": "agy",
        "strengths": ["planning", "codebase reasoning", "analysis"],
    },
    {
        "provider": "copilot",
        "family": "GitHub Copilot CLI",
        "model": "gpt-5.4-mini",
        "effort": "low",
        "role": "fast/simple subtasks, quick reviews, routine glue",
        "bin": "copilot",
        "strengths": ["fast", "glue", "simple fixes", "quick review"],
    },
    {
        "provider": "hermes",
        "family": "NousResearch Hermes",
        "model": "",
        "effort": "high",
        "role": "optional agentic worker when Hermes is installed",
        "bin": "hermes",
        "strengths": ["agentic", "tools", "general"],
    },
]


@dataclass
class CodefusionConfig:
    orchestrator_provider: str = ORCHESTRATOR_PROVIDER
    orchestrator_model: str = ORCHESTRATOR_MODEL
    orchestrator_effort: str = ORCHESTRATOR_EFFORT
    roster: list[dict[str, Any]] = field(default_factory=lambda: list(DEFAULT_ROSTER))
    # Default auto-routing prefers Meta LOOP for real work.
    default_mode: str = "auto"
    panel_timeout_s: int = 600
    state_root: str = ""
    # When true, prefer Fusion-style multi-agent modes over durable PM jobs.
    fusion_first: bool = True
    # Meta LOOP labor layer (diagram: parallel cheap Gemini Flash workers).
    metaloop_worker_count: int = 4
    metaloop_worker_provider: str = "copilot"
    metaloop_worker_model: str = "gemini-3.5-flash"
    # Board Advisor (Fable 5) — off hot path; on-demand only.
    metaloop_advisor_provider: str = "claude"
    metaloop_advisor_label: str = "Fable 5"
    # Puppetmaster dashboard port (rebranded board).
    dashboard_port: int = 8787
    allowlist: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "CodefusionConfig":
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})


def config_path() -> Path:
    return state_dir() / "config.json"


def load_config() -> CodefusionConfig:
    path = config_path()
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                cfg = CodefusionConfig.from_dict(data)
                if not cfg.state_root:
                    cfg.state_root = str(state_dir())
                return cfg
        except (OSError, json.JSONDecodeError):
            pass
    cfg = CodefusionConfig(state_root=str(state_dir()))
    return cfg


def save_config(cfg: CodefusionConfig) -> Path:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg.to_dict(), indent=2) + "\n", encoding="utf-8")
    return path


def env_overrides(cfg: Optional[CodefusionConfig] = None) -> dict[str, str]:
    """Environment variables panel adapters / fusion scripts honor."""
    c = cfg or load_config()
    return {
        "CODEFUSION_HOST": c.orchestrator_provider,
        "FUSION_HOST": c.orchestrator_provider,
        "CODEFUSION_ORCHESTRATOR_MODEL": c.orchestrator_model,
        "FUSION_CODEX_MODEL": c.orchestrator_model,
        "FUSION_CODEX_EFFORT": c.orchestrator_effort,
        "CODEFUSION_STATE_DIR": c.state_root or str(state_dir()),
    }
