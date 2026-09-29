"""Builder vs Breaker — adversarial loop where the ARBITER is the test runner.

Unlike debate (which argues opinions), the breaker must produce executable
counterexamples — failing tests, edge cases, security probes. With a `gate_cmd`
the gate decides (hard mode); without one, the builder hardens defensively each
round against the breaker's findings (soft mode). The loop ends when the breaker
can't break it or the round budget is spent. This is how you get robust code
instead of code two models agreed looked fine.
"""
from __future__ import annotations

from .adapter import dispatch
from .gate import run_gate


def run(task, builder="codex", breaker="grok", rounds=2, gate_cmd=None, cwd=None, timeout=None):
    transcript = []
    sol = dispatch(
        builder,
        f"Task: {task}\n\nWrite a correct, complete solution (code). Return only the code.",
        timeout=timeout,
    )
    solution = sol.text
    transcript.append({"phase": "build", "round": 0, "provider": builder, "text": solution})
    survived = False

    for rnd in range(1, int(rounds) + 1):
        atk = dispatch(
            breaker,
            f"You are an adversarial tester. Solution to:\n{task}\n\nSolution:\n{solution}\n\n"
            "Produce concrete, RUNNABLE failing tests or edge-case inputs that break it "
            "(boundaries, malformed input, auth/permission gaps, races, security). If you "
            "genuinely cannot break it, reply exactly 'NO BREAK FOUND'. Otherwise return only "
            "the test code/inputs.",
            timeout=timeout,
        )
        broke_claim = "NO BREAK FOUND" not in (atk.text or "").upper()
        gate = run_gate(gate_cmd, cwd=cwd) if gate_cmd else {"passed": None, "skipped": True}
        transcript.append({"phase": "break", "round": rnd, "provider": breaker,
                           "text": atk.text, "gate": gate})

        # hard mode: gate decides; soft mode: trust the breaker's claim
        failed = gate.get("passed") is False if gate_cmd else broke_claim
        if not failed:
            survived = True
            break

        fix = dispatch(
            builder,
            f"Task: {task}\n\nYour solution:\n{solution}\n\nThe adversary found a failure:\n"
            f"{atk.text}\n" + (f"\nGate log:\n{gate.get('log','')}\n" if gate_cmd else "")
            + "\nFix the solution so these cases pass. Return only the corrected code.",
            timeout=timeout,
        )
        if fix.ok and fix.text.strip():
            solution = fix.text
        transcript.append({"phase": "fix", "round": rnd, "provider": builder, "text": solution})

    return {
        "pattern": "builder_breaker", "task": task, "builder": builder, "breaker": breaker,
        "rounds": int(rounds), "survived_adversary": survived, "final": solution,
        "transcript": transcript,
    }
