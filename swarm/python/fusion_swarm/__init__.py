"""fusion_swarm — Python orchestration patterns for Fusion, run over the verified
CLI adapters (codex/copilot/opencode/grok/andrewcode). Ported from the Swarms
framework and the council swarm-structures brainstorm, but with no dependency on
either: every "agent call" shells out to Fusion's own adapters.
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

# Nested-hive modules may land in sibling slices. Import what exists; leave the
# rest off the package until those files are present so `import fusion_swarm`
# never fails because a parallel slice has not landed yet.
_HIVE_EXPORTS = (
    "board", "identities", "spawn", "designer", "hive", "hive_prompts",
    "lanes", "factory",
)
for _name in _HIVE_EXPORTS:
    try:
        # fromlist=[_name] on the PACKAGE (not the submodule) binds fusion_swarm.<name>
        __import__(__name__, fromlist=[_name])
    except ImportError:
        pass
del _name

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
    # Nested hive (Hive Board + designer + spawn):
    "board", "identities", "spawn", "designer", "hive", "hive_prompts",
    "lanes", "factory",
]
