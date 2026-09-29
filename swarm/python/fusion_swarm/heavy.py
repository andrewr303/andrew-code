"""HeavySwarm — deep, role-specialized analysis over the Fusion panel.

Ported from swarms.structs.HeavySwarm. The task is decomposed into four
specialized sub-questions — Research, Analysis, Alternatives, Verification —
each answered by a panelist in parallel, then synthesized. Optional refinement
loops build on prior findings. Best for research-grade, high-stakes analysis.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor

from .adapter import Reply, available, dispatch
from .synth import cli_synthesize, pick_aggregator

ROLES = {
    "Research": "Gather the facts, evidence, primary sources, and current state relevant to the task.",
    "Analysis": "Analyze deeply: mechanisms, tradeoffs, root causes, and second-order effects.",
    "Alternatives": "Surface the strongest alternative approaches, counterarguments, and options not yet considered.",
    "Verification": "Stress-test and verify: what could be wrong, what must be checked, failure modes, and your confidence.",
}

_QUESTION_GEN = (
    "Decompose the task below into FOUR sharp, specialized sub-questions — one each for a "
    "Research agent, an Analysis agent, an Alternatives agent, and a Verification agent. "
    "Output EXACTLY four lines, each formatted 'ROLE: question'. No preamble, no extra text.\n\n"
    "TASK:\n{task}"
)


def _gen_questions(task, gen_cli):
    out = dispatch(gen_cli, _QUESTION_GEN.format(task=task))
    qs = {}
    if out.ok:
        for line in out.text.splitlines():
            for role in ROLES:
                if line.strip().lower().startswith(role.lower() + ":"):
                    qs[role] = line.split(":", 1)[1].strip()
    for role, desc in ROLES.items():
        qs.setdefault(role, f"{desc} For the task: {task}")
    return qs


def run(task, providers=None, aggregator="codex", loops=1, timeout=None):
    provs = providers or available()
    gen = pick_aggregator(provs, aggregator)
    role_list = list(ROLES)
    transcript = []
    context = task
    last_by_role = {}

    for loop in range(1, int(loops) + 1):
        qs = _gen_questions(context, gen)
        assign = {role: provs[i % len(provs)] for i, role in enumerate(role_list)}
        with ThreadPoolExecutor(max_workers=len(role_list)) as ex:
            futs = {
                ex.submit(
                    dispatch,
                    assign[role],
                    f"You are the {role} agent in a deep-analysis swarm. {ROLES[role]}\n\n"
                    f"Your question: {qs[role]}\n\nAnswer thoroughly, with evidence and stated confidence.",
                    timeout=timeout,
                ): role
                for role in role_list
            }
            res = {futs[f]: f.result() for f in futs}
        for role in role_list:
            r = res[role]
            last_by_role[role] = r
            transcript.append(
                {"loop": loop, "role": role, "provider": assign[role],
                 "status": r.status, "text": r.text}
            )
        if loop < int(loops):
            findings = "\n\n".join(
                f"[{role}] {res[role].text}" for role in role_list if res[role].ok
            )
            context = f"{task}\n\nPrior-loop findings to refine and extend:\n{findings}"

    result = {
        "pattern": "heavy",
        "task": task,
        "loops": int(loops),
        "roles": role_list,
        "panel": provs,
        "question_gen": gen,
        "transcript": transcript,
    }
    if aggregator and aggregator != "none":
        role_replies = [
            Reply(role, last_by_role[role].text, last_by_role[role].status, last_by_role[role].ok)
            for role in role_list
        ]
        syn = cli_synthesize(
            task, role_replies, aggregator=gen,
            instruction=(
                "These are four specialist findings (Research, Analysis, Alternatives, "
                "Verification). Integrate them into one comprehensive, well-structured report; "
                "do not just concatenate."
            ),
        )
        result["aggregator"] = gen
        result["synthesis"] = syn.text if syn.ok else None
        result["synthesis_ok"] = syn.ok
    return result
