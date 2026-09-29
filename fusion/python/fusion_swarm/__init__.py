"""fusion_swarm — Python orchestration patterns for Fusion, run over the verified
CLI adapters (codex/copilot/opencode/grok). Ported from the Swarms framework and
the council swarm-structures brainstorm, but with no dependency on either: every
"agent call" shells out to Fusion's own adapters.
"""
from . import (  # noqa: F401
    adapter,
    agency_context,
    ballot,
    bestof,
    builder_breaker,
    contracts,
    discuss,
    flow,
    gate,
    graph,
    heavy,
    hierarchical,
    kgraph,
    ladder,
    memory_service,
    metaloop,
    modifiers,
    moa,
    policy,
    reasoning,
    refine,
    speclock,
    steering,
    synth,
    workspaces,
)

__all__ = [
    "adapter", "moa", "heavy", "flow", "discuss", "hierarchical", "graph",
    "refine", "bestof", "reasoning", "synth",
    # council swarm-structures additions:
    "gate", "modifiers", "ladder", "speclock", "builder_breaker", "ballot",
    # MetaLoop (fusion:metaloop) additions:
    "contracts", "policy", "workspaces", "metaloop",
    # Agency Context, Memory, Steering (fusion v2.2):
    "agency_context", "memory_service", "steering",
    # Graph engineering (fusion:graph) - knowledge-graph half:
    "kgraph",
]
