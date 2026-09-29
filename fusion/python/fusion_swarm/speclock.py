"""Spec-Locked Parallel Cells — contract-first fan-out.

The hard part of multi-agent coding is INTEGRATION, not generation. Solve it by
writing a hard interface contract first (types + signatures + failing test stubs),
then fan out modules in parallel against that shared contract. Integration becomes
mechanical: if it typechecks / the stubs pass, the pieces fit by construction. A
build/typecheck GATE is the integrator; only the failing module is escalated.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor

from .adapter import available, dispatch
from .gate import run_gate
from .synth import pick_aggregator


def run(task, modules=None, contract_author="codex", implementers=None,
        gate_cmd=None, cwd=None, timeout=None):
    provs = available()
    author = pick_aggregator(provs, contract_author)

    if not modules:
        plan = dispatch(
            author,
            "List the 2-4 independent modules this task should decompose into. One per line "
            "as 'N. name: one-line responsibility'. Prefer clean seams with minimal coupling.\n\n"
            f"TASK:\n{task}",
            timeout=timeout,
        )
        modules = [
            re.sub(r"^\s*\d+[.)]\s*", "", l).strip()
            for l in plan.text.splitlines()
            if re.match(r"^\s*\d+[.)]", l)
        ] or [task]

    contract = dispatch(
        author,
        "Write a HARD CONTRACT all modules must satisfy: exact types, function signatures, "
        "and failing test stubs. This is the single source of truth — implementers may not "
        "change it.\n\nModules:\n" + "\n".join(f"- {m}" for m in modules)
        + f"\n\nTASK:\n{task}\n\nReturn the contract (interfaces + stubs).",
        timeout=timeout,
    )

    impl = implementers or provs
    assign = {i: impl[i % len(impl)] for i in range(len(modules))}
    with ThreadPoolExecutor(max_workers=max(1, len(modules))) as ex:
        futs = {
            ex.submit(
                dispatch,
                assign[i],
                "Implement ONLY your module against the shared contract. Do NOT change the "
                f"contract or other modules.\n\nCONTRACT:\n{contract.text}\n\n"
                f"YOUR MODULE: {modules[i]}\n\nTASK:\n{task}\n\nReturn only your module's code.",
                timeout=timeout,
            ): i
            for i in range(len(modules))
        }
        res = {futs[f]: f.result() for f in futs}

    transcript = [
        {"module": modules[i], "provider": assign[i], "status": res[i].status, "text": res[i].text}
        for i in range(len(modules))
    ]
    gate = run_gate(gate_cmd, cwd=cwd) if gate_cmd else {"passed": None, "skipped": True}
    return {
        "pattern": "speclock", "task": task, "contract_author": author,
        "modules": modules, "contract": contract.text, "transcript": transcript,
        "gate": gate,
    }
