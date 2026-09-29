"""Codefusion — unified multi-agent coding orchestrator.

Core architecture is **Meta LOOP**:

* Orchestrator (GPT-5.6) — hot path: Plan → Delegate → Verify → Synthesize
* Advisor (Fable 5) — on-demand critic off the hot path (strategy, taste, risk)
* Labor layer — parallel cheap workers (e.g. Gemini 3.5 Flash)

Also meshes Fusion peer modes, Fusion-ML patterns, subagent catalogs, and a
Puppetmaster-style live dashboard. Routing is capability-first, not cost-first.
"""

from __future__ import annotations

__version__ = "0.1.0"
__product__ = "Codefusion"
__orchestrator_model__ = "gpt-5.6"
__architecture__ = "metaloop"
