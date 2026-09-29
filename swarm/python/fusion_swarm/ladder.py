"""Escalation Ladder — cheapest capable tier first; a GATE failure (or low
confidence) escalates to a stronger, costlier tier with the failure log attached,
so each tier starts smarter. Stops at the first tier that passes.

The cheapest structure to ship and an immediate cost win: most routine work
(lint fixes, small bugs, boilerplate) clears tier 1, and you only pay flagship
rates for the genuinely hard cases.
"""
from __future__ import annotations

from .adapter import dispatch
from .gate import run_gate
from .modifiers import parse_confidence

# cheap → mid → strong. Effort is what each adapter understands.
DEFAULT_TIERS = [
    {"label": "cheap", "provider": "opencode", "effort": "minimal"},
    {"label": "mid", "provider": "codex", "effort": "medium"},
    {"label": "strong", "provider": "codex", "effort": "xhigh"},
]


def run(task, tiers=None, gate_cmd=None, cwd=None, confidence_threshold=0.7, timeout=None):
    tiers = tiers or DEFAULT_TIERS
    transcript = []
    failure = ""
    last = None
    for t in tiers:
        prompt = f"Task: {task}\n\nProduce your best complete solution."
        if failure:
            prompt += (
                f"\n\nA previous, cheaper attempt FAILED verification:\n{failure}\n\n"
                f"Diagnose the underlying cause and fix it."
            )
        prompt += "\n\nEnd with a line 'CONFIDENCE: <0-1>'."
        r = dispatch(t["provider"], prompt, effort=t.get("effort", ""), timeout=timeout)
        last = r
        conf = parse_confidence(r.text)
        gate = run_gate(gate_cmd, cwd=cwd) if gate_cmd else {"passed": None, "skipped": True}
        transcript.append({
            "tier": t["label"], "provider": t["provider"], "effort": t.get("effort", ""),
            "status": r.status, "confidence": conf, "gate": gate,
        })
        if gate_cmd:
            if gate.get("passed"):
                return _done(task, r.text, True, t["label"], transcript, conf)
            failure = (gate.get("log", "") or "")[-1500:]
        else:  # soft gate: confidence
            if conf is None or conf >= confidence_threshold:
                return _done(task, r.text, None, t["label"], transcript, conf)
            failure = f"Self-reported confidence {conf} < threshold {confidence_threshold}."
    return _done(task, last.text if last else None, False, tiers[-1]["label"], transcript, None)


def _done(task, final, passed, tier, transcript, conf):
    return {
        "pattern": "ladder", "task": task, "final": final, "passed": passed,
        "tier_used": tier, "escalations": len(transcript) - 1,
        "confidence": conf, "transcript": transcript,
    }
