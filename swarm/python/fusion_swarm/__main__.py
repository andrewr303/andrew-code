"""Fusion swarm CLI: `python -m fusion_swarm <pattern> "<task>" [opts] [--json]`.

Patterns:
  moa         layered Mixture-of-Agents          --layers N
  heavy       4-role deep analysis swarm         --loops N
  discuss     group-chat brainstorm              --rounds N
  hierarchy   director plans + assigns workers   --director PROV
  graph       graph engineering: typed-node DAG  --spec graph.json | --nodes "id=prov,..." --edges "a>b,..."
              (add --plan to lint + schedule + cost it without dispatching anything)
  kg          knowledge graph store              --op stats|init|ingest|lint|candidates|fuse|query|path|serialize
  flow        AgentRearrange flow DSL            --flow "codex -> copilot, grok"
  refine      generator->evaluator quality gate  --generator P --evaluator P --threshold N --rounds N
  bestof      best-of-N single provider (self-MoA-seq) --provider P --samples N
  reflexion   one panelist: draft->critique->revise   --provider P --iterations N
  selfconsist one panelist sampled N times, majority   --provider P --samples N
  gkp         generate knowledge, then answer         --provider P
  roster      ping every CLI runtime live + show swarm config for every mode (no task needed)
  hive        nested Hive Board swarm                --dry-run --spec --children --captains --architect
  designer    print topology catalog or a design_prompt (never dispatches)
  board       redirect: use python -m fusion_swarm.board
  factory     Dark-Factory alias of hive (discover/define/develop/deliver)
"""
from __future__ import annotations

import argparse
import json
import sys

from . import (
    adapter, ballot, bestof, builder_breaker, discovery, discuss, flow, graph,
    heavy, hierarchical, kgraph, ladder, moa, modes_catalog, reasoning, refine,
    speclock,
)
from . import gate as gatemod
from . import metaloop as metaloopmod
from . import policy as policymod
from .contracts import TaskSpec, ContractError

NEEDS_PROVIDER = {"bestof", "reflexion", "selfconsist", "gkp"}


def build_parser():
    ap = argparse.ArgumentParser(prog="fusion_swarm")
    ap.add_argument("pattern", choices=[
        "moa", "heavy", "discuss", "hierarchy", "graph", "flow",
        "refine", "bestof", "reflexion", "selfconsist", "gkp",
        # graph engineering (fusion:graph) — the knowledge-graph half:
        "kg",
        # council swarm-structures additions:
        "ladder", "speclock", "breaker", "ballot", "gate",
        # MetaLoop (fusion:metaloop):
        "metaloop",
        # live provider/model + mode-catalog report (no task, no dispatch):
        "roster",
        # nested hive (Hive Board + designer; board is a redirect):
        "hive", "designer", "board", "factory",
    ])
    ap.add_argument("task", nargs="?", default="")
    ap.add_argument("--task-file")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--timeout", type=int, default=None)
    ap.add_argument("--providers", default="")
    ap.add_argument("--aggregator", default="codex")
    ap.add_argument("--no-record", action="store_true")
    ap.add_argument("--layers", type=int, default=2)
    ap.add_argument("--rounds", type=int, default=2)
    ap.add_argument("--loops", type=int, default=1)
    ap.add_argument("--iterations", type=int, default=2)
    ap.add_argument("--samples", type=int, default=5)
    ap.add_argument("--provider", default="codex")
    ap.add_argument("--generator", default="codex")
    ap.add_argument("--evaluator", default="copilot")
    ap.add_argument("--director", default="codex")
    ap.add_argument("--threshold", type=int, default=80)
    ap.add_argument("--flow", dest="flow_dsl")
    ap.add_argument("--nodes")
    ap.add_argument("--edges")
    # graph engineering (fusion:graph):
    ap.add_argument("--spec", help="graph: JSON spec file (typed nodes, budget, repeat). "
                                   "kg: ontology or extraction payload file")
    ap.add_argument("--plan", action="store_true",
                    help="graph: lint + schedule + cost the topology WITHOUT dispatching")
    ap.add_argument("--approve", default="",
                    help="graph: comma-separated human-gate node ids to treat as approved")
    ap.add_argument("--max-workers", dest="max_workers", type=int, default=8)
    # kg (knowledge-graph store):
    ap.add_argument("--op", default="stats", help="kg: operation")
    ap.add_argument("--graph-name", dest="graph_name", default="default",
                    help="kg: which stored graph (~/.fusion/graph/<name>)")
    ap.add_argument("--question", default="", help="kg: question to retrieve context for")
    ap.add_argument("--source", default="", help="kg: provenance source for an ingest")
    ap.add_argument("--as-of", dest="as_of", default="",
                    help="kg: answer as of this timestamp (bitemporal)")
    ap.add_argument("--hops", type=int, default=2, help="kg: k-hop expansion (1-2)")
    ap.add_argument("--apply", action="store_true",
                    help="kg: actually apply auto-merges (default is dry: report only)")
    ap.add_argument("--head", default="", help="kg: head entity id")
    ap.add_argument("--rel", default="", help="kg: relation type")
    ap.add_argument("--tail", default="", help="kg: tail entity id")
    # gate / ladder / speclock / breaker / ballot:
    ap.add_argument("--gate-cmd", dest="gate_cmd", default="")
    ap.add_argument("--cwd", default=None)
    ap.add_argument("--builder", default="codex")
    ap.add_argument("--breaker", default="grok")
    ap.add_argument("--contract-author", dest="contract_author", default="codex")
    ap.add_argument("--confidence", type=float, default=0.7)
    # metaloop:
    ap.add_argument("--advisor", default=None,
                    choices=["off", "on-demand", "auto", "always"])
    ap.add_argument("--advisor-max", dest="advisor_max", type=int, default=None)
    ap.add_argument("--max-repair-rounds", dest="max_repair_rounds", type=int, default=None)
    ap.add_argument("--max-attempts-per-task", dest="max_attempts_per_task", type=int, default=None)
    ap.add_argument("--expert-concurrency", dest="expert_concurrency", type=int, default=None)
    ap.add_argument("--fast-concurrency", dest="fast_concurrency", type=int, default=None)
    ap.add_argument("--workspace-mode", dest="workspace_mode", default=None,
                    choices=["proposal", "worktree"])
    ap.add_argument("--risk-threshold", dest="risk_threshold", type=int, default=None)
    ap.add_argument("--plan-file", dest="plan_file", default=None)
    ap.add_argument("--run-id", dest="run_id", default="ml_run")
    # roster:
    ap.add_argument("--force-refresh", dest="force_refresh", action="store_true",
                    help="roster: re-probe every CLI live instead of reading the model cache")
    # hive / designer:
    ap.add_argument("--dry-run", dest="dry_run", action="store_true",
                    help="hive: build the tree + board without subprocess dispatch")
    ap.add_argument("--children", dest="children", type=int, default=4,
                    help="hive: children per captain (default 4)")
    ap.add_argument("--children-per-captain", dest="children", type=int,
                    help="hive: alias of --children")
    ap.add_argument("--captains", dest="captains", default="",
                    help="hive: comma-separated captain providers (e.g. andrewcode,opencode,grok,copilot)")
    ap.add_argument("--architect", dest="architect", default="fable",
                    help="hive: architect provider (default fable)")
    ap.add_argument("--state-dir", dest="state_dir", default=None,
                    help="hive: state directory for the Hive Board (default ~/.fusion)")
    ap.add_argument("--spec-file", dest="spec", default=None,
                    help="hive: SwarmSpec JSON file (alias of --spec)")
    return ap


def _ledger_record(pattern, res):
    panel = list(res.get("panel") or [])
    if not panel:  # derive from transcript provider fields
        for item in res.get("transcript") or []:
            pr = item.get("provider")
            if pr and pr not in panel:
                panel.append(pr)
    if not panel and res.get("provider"):
        panel = [res["provider"]]
    status = res.get("status") or {}
    panelists = [{"provider": pr, "status": status.get(pr, "returned")} for pr in panel if pr]
    if not panelists:
        panelists = [{"provider": res.get("provider", "codex"), "status": "returned"}]
    return {
        "run_id": f"swarm-{pattern}",
        "task_type": f"swarm:{pattern}",
        "mode": pattern,
        "judge": res.get("aggregator") or res.get("contract_author") or "codex",
        "winner": res.get("winner") or res.get("winner_provider"),
        "panelists": panelists,
    }


def _metaloop_config(args):
    return metaloopmod.MetaLoopConfig.from_env(
        advisor_policy=args.advisor,
        max_advisor_calls=args.advisor_max,
        max_repair_rounds=args.max_repair_rounds,
        max_attempts_per_task=args.max_attempts_per_task,
        expert_concurrency=args.expert_concurrency,
        fast_concurrency=args.fast_concurrency,
        workspace_mode=args.workspace_mode,
        risk_threshold=args.risk_threshold,
    )


def _metaloop_report(task, args):
    """Engine-side planning aid for the host. Reports config, detected providers
    with their tier/family/harness, and — if a plan file of TaskSpecs is given —
    the routing decisions, dependency waves, and advisor-preflight trigger. The
    host (GPT Chief Operator) still owns planning/integration in-context; this is
    the deterministic scaffold it reads from."""
    cfg = _metaloop_config(args)
    live = adapter.metaloop_availability()
    roster = {
        p: {**{k: v for k, v in adapter.PROVIDER_META.get(p, {}).items() if k != "strengths"},
            "sessions": adapter.WORKER_SESSIONS.get(p, 1),
            "available": bool(live.get(p))}
        for p in (adapter.OPERATOR_PROVIDERS + adapter.WORKER_PROVIDERS + adapter.ADVISOR_PROVIDERS)
    }
    out = {
        "pattern": "metaloop",
        "run_id": args.run_id,
        "task": task,
        "config": {
            "advisor_policy": cfg.advisor_policy,
            "max_advisor_calls": cfg.max_advisor_calls,
            "max_repair_rounds": cfg.max_repair_rounds,
            "max_attempts_per_task": cfg.max_attempts_per_task,
            "expert_concurrency": cfg.expert_concurrency,
            "fast_concurrency": cfg.fast_concurrency,
            "max_total_external_calls": cfg.max_total_external_calls,
            "max_wall_seconds": cfg.max_wall_seconds,
            "workspace_mode": cfg.workspace_mode,
            "risk_threshold": cfg.risk_threshold,
        },
        "roster": roster,
        "correlation_groups": adapter.CORRELATION_GROUPS,
        "advisor_excluded_from_worker_panel": True,
    }
    if args.plan_file:
        with open(args.plan_file, encoding="utf-8") as fh:
            raw = json.load(fh)
        tasks = [TaskSpec.from_dict(t) for t in raw]
        errs = {t.id: t.validate() for t in tasks}
        bad = {tid: e for tid, e in errs.items() if e}
        if bad:
            out["plan_errors"] = bad
            return out
        routes = [policymod.route(t) for t in tasks]
        out["routes"] = [
            {"task_id": r.task_id, "tier": r.tier, "provider": r.provider,
             "expert_pressure": r.expert_pressure, "hard_override": r.hard_override,
             "needs_human_approval": r.needs_human_approval,
             "advisor_preflight": r.advisor_preflight, "reason": r.reason}
            for r in routes
        ]
        out["waves"] = metaloopmod.topological_waves(tasks)
        trig, why = metaloopmod.advisor_preflight_trigger(tasks, cfg)
        out["advisor_preflight"] = {"triggered": trig, "reason": why}
    return out


def _roster_report(args):
    """`swarm.sh roster [--json] [--force-refresh]` — the deterministic engine
    seam every mode's live-model-awareness routes through (moa included, so
    patching 22+ command files individually is never necessary): pings every
    configured CLI runtime for its live model list (cache-first unless
    --force-refresh), merges in tier/family/harness metadata, and reports the
    declared swarm config for every /fusion:<mode> command. No task, no
    dispatch to a panelist for actual work — this is inventory, not a run."""
    live = adapter.metaloop_availability()
    models = discovery.discover_all(force=args.force_refresh)
    roster = {}
    for p in (adapter.OPERATOR_PROVIDERS + adapter.WORKER_PROVIDERS
              + adapter.ADVISOR_PROVIDERS + ["copilot"]):
        meta = {k: v for k, v in adapter.PROVIDER_META.get(p, {}).items() if k != "strengths"}
        roster[p] = {
            **meta,
            "sessions": adapter.WORKER_SESSIONS.get(p, 1),
            "available": bool(live.get(p, p == "copilot")),
            "selectable_as_worker": p in adapter.WORKER_PROVIDERS,
            "models": models.get(p, {}),
        }
    return {
        "pattern": "roster",
        "roster": roster,
        "correlation_groups": adapter.CORRELATION_GROUPS,
        "advisor_excluded_from_worker_panel": True,
        "modes": modes_catalog.all_modes(),
    }


def _pretty(pattern, res):
    if pattern == "roster":
        print("=== fusion swarm: roster ===")
        for p, m in (res.get("roster") or {}).items():
            sess = m.get("sessions", 1)
            sess_s = f" x{sess}" if sess > 1 else "   "
            mark = "live" if m.get("available") else "absent"
            models = m.get("models") or {}
            mstatus = models.get("status", "?")
            mcount = len(models.get("models") or [])
            print(f"  {p:9s}{sess_s} tier={m.get('tier', '?'):9s} family={m.get('model_family', '?'):8s} "
                  f"[{mark}]  models: {mstatus} ({mcount})  -- {models.get('source', '')}")
        print(f"\ncorrelation groups: {res.get('correlation_groups')}")
        print(f"\nmodes ({len(res.get('modes') or [])}):")
        for mo in res.get("modes") or []:
            eng = mo.get("engine_pattern") or "dynamic"
            print(f"  /fusion:{mo['mode']:12s} {eng:10s} skill={mo.get('invokes_skill') or '-'}")
        return
    if pattern == "metaloop":
        print("=== fusion swarm: metaloop ===")
        print(f"run_id: {res.get('run_id')}")
        c = res.get("config", {})
        print(f"advisor: {c.get('advisor_policy')} (max {c.get('max_advisor_calls')})  "
              f"| repair<= {c.get('max_repair_rounds')}  | workspace: {c.get('workspace_mode')}")
        print("roster (Fable=CEO/advisor + codex=Chief Operator + tiered workers):")
        for p, m in (res.get("roster") or {}).items():
            mark = "live" if m.get("available") else "absent"
            sess = m.get("sessions", 1)
            sess_s = f" x{sess}" if sess > 1 else "   "
            print(f"  {p:9s}{sess_s} tier={m.get('tier'):7s} family={m.get('model_family'):7s} "
                  f"harness={m.get('harness'):20s} [{mark}]")
        print(f"correlation groups: {res.get('correlation_groups')}  "
              f"(fast tier = 2 agy sessions on one Gemini model = one family)")
        if res.get("plan_errors"):
            print("\nPLAN ERRORS:")
            for tid, e in res["plan_errors"].items():
                print(f"  {tid}: {e}")
            return
        if res.get("routes"):
            print("\nrouting:")
            for r in res["routes"]:
                print(f"  {r['task_id']:6s} -> {r['tier']:6s} "
                      f"(ep={r['expert_pressure']}, override={r['hard_override']}, "
                      f"approval={r['needs_human_approval']})  {r['reason']}")
            print(f"\nwaves: {res.get('waves')}")
            ap_ = res.get("advisor_preflight", {})
            print(f"advisor preflight: {ap_.get('triggered')}  ({ap_.get('reason')})")
        return
    if pattern == "graph":
        print(f"=== fusion graph: {res.get('name')} ===")
        pl = res.get("plan") or {}
        print(f"nodes={pl.get('nodes')}  critical path={pl.get('critical_path')} stages  "
              f"max parallel={pl.get('max_parallel')}  "
              f"est calls={pl.get('est_calls_total')} ({pl.get('rounds')} round(s))")
        for lvl, ids in (pl.get("stages") or {}).items():
            kinds = res.get("kinds") or {}
            print(f"  stage {lvl}: " + ", ".join(f"{i}[{kinds.get(i, '?')}]" for i in ids))
        free = pl.get("free_nodes") or []
        if free:
            print(f"  deterministic (no model call): {', '.join(free)}")
        issues = res.get("lint") or []
        if issues:
            print("\nlint:")
            for i in issues:
                print(f"  {i['level'].upper():5s} {i['code']:16s} {i['node'] or '-'}: {i['msg']}")
        if not res.get("ran"):
            print("\n(no dispatch — " +
                  ("lint errors blocked the run" if res.get("blocked_by_lint") else "plan only") + ")")
            return
        print(f"\nrounds run: {res.get('rounds_run')}  calls: {res.get('calls')}")
        for r in res.get("rounds") or []:
            print(f"  round {r['round']}: {r['new_items']} new  {r['calls']} calls  "
                  f"absent={r['absent'] or '-'}")
        if res.get("needs_approval"):
            print(f"\nAWAITING HUMAN APPROVAL: {', '.join(res['needs_approval'])}"
                  "  (re-run with --approve <ids>)")
        for nid, text in (res.get("final") or {}).items():
            print(f"\n[{nid}]\n{text}")
        return
    if pattern == "kg":
        print(f"=== fusion knowledge graph: {res.get('op')} ===")
        if res.get("op") == "lint":
            print(f"errors={res.get('errors')} warnings={res.get('warnings')}")
            for i in res.get("issues") or []:
                print(f"  {i['level'].upper():5s} {i['code']:22s} {i['ref']}: {i['msg']}")
            return
        if res.get("op") == "query":
            print(f"seeds: {res.get('seeds')}  hops: {res.get('hops')}")
            print(f"recommendation: {res.get('recommendation')}")
            print("\n--- retrieved subgraph ---\n" + (res.get("context") or "(empty)"))
            return
        if res.get("context") is not None and res.get("op") == "serialize":
            print(res.get("context") or "(empty)")
            return
        print(json.dumps({k: v for k, v in res.items() if k != "pattern"},
                         ensure_ascii=False, indent=2)[:4000])
        return
    if pattern == "designer":
        print("=== fusion swarm: designer ===")
        if res.get("error"):
            print("error:", res["error"])
            return
        if res.get("prompt"):
            print(res["prompt"])
            return
        for item in res.get("catalog") or []:
            name = item.get("name") if isinstance(item, dict) else getattr(item, "name", item)
            when = item.get("when") if isinstance(item, dict) else getattr(item, "when", "")
            print(f"  {name}: {when}")
        return
    if pattern == "board":
        print("error:", res.get("error") or "use python -m fusion_swarm.board")
        return
    if pattern == "hive":
        print("=== fusion swarm: hive ===")
        if res.get("error"):
            print("error:", res["error"])
            return
        print(f"run_id: {res.get('run_id')}  dry_run: {res.get('dry_run')}")
        print(f"board: {res.get('board_path')}")
        print(f"agents: {len(res.get('agents') or [])}  "
              f"posts_seeded: {len(res.get('posts_seeded') or [])}")
        if res.get("board_path"):
            print(f"talk on the board: python -m fusion_swarm.board --db {res['board_path']} poll --agent arch")
        return
    if pattern == "factory":
        print("=== fusion swarm: factory ===")
        if res.get("error"):
            print("error:", res["error"])
            return
        print(f"run_id: {res.get('run_id')}  dry_run: {res.get('dry_run')}")
        print(f"board: {res.get('board_path')}")
        print(f"agents: {len(res.get('agents') or [])}")
        return
    print(f"=== fusion swarm: {pattern} ===")
    if pattern == "gate":
        print(f"command: {res.get('command')}")
        print(f"passed:  {res.get('passed')}  (rc={res.get('returncode')})")
        print("--- log (tail) ---")
        print((res.get("log") or "")[-1500:])
        return
    if res.get("error"):
        print("error:", res["error"])
        return
    final = res.get("synthesis") or res.get("final") or res.get("winning_proposal")
    if isinstance(final, dict):
        for k, v in final.items():
            print(f"\n[{k}]\n{v}")
    elif final:
        print(final)
    else:
        for item in (res.get("transcript") or [])[-6:]:
            print(json.dumps(item, ensure_ascii=False)[:500])
    if res.get("winner_provider"):
        print(f"\nwinner: {res['winner_provider']}  | ranking: {res.get('ranking')}")
    if res.get("tier_used"):
        print(f"\ntier used: {res['tier_used']}  | escalations: {res.get('escalations')}  | passed: {res.get('passed')}")
    if res.get("survived_adversary") is not None:
        print(f"\nsurvived adversary: {res['survived_adversary']}")
    g = res.get("gate")
    if isinstance(g, dict) and not g.get("skipped"):
        print(f"gate: passed={g.get('passed')}  ({g.get('command')})")
    if res.get("panel"):
        print("\npanel:", ", ".join(res["panel"]))
    if res.get("aggregator"):
        print("aggregator:", res["aggregator"])
    if res.get("final_score") is not None:
        print("final_score:", res["final_score"], "/ threshold", res.get("threshold"))


def main(argv=None):
    ap = build_parser()
    args = ap.parse_args(argv)

    p = args.pattern
    task = args.task
    if args.task_file:
        with open(args.task_file, encoding="utf-8") as fh:
            task = fh.read().strip()
    if not task and p not in ("gate", "roster", "kg", "designer", "board"):
        ap.error("a task is required (positional or --task-file)")

    provs = [x.strip() for x in args.providers.split(",") if x.strip()] or None
    t = args.timeout
    gate_cmd = args.gate_cmd or None

    # Record the invoked engine mode so adapter.dispatch can resolve per-mode
    # model/effort overrides (FUSION_<MODE>_<PROVIDER>_<FIELD>). 'roster' is
    # inventory, not a run; 'metaloop' is host-skill-orchestrated (its per-mode
    # keys are intentionally not generated). For those we CLEAR the marker
    # (set_invoked_mode(None)) rather than leave a possibly-inherited stale
    # FUSION_INVOKED_MODE from the shell environment in force.
    adapter.set_invoked_mode(None if p in ("roster", "metaloop", "kg", "designer", "board") else p)

    if p == "moa":
        res = moa.run(task, providers=provs, layers=args.layers, aggregator=args.aggregator, timeout=t)
    elif p == "heavy":
        res = heavy.run(task, providers=provs, aggregator=args.aggregator, loops=args.loops, timeout=t)
    elif p == "discuss":
        res = discuss.run(task, providers=provs, rounds=args.rounds, aggregator=args.aggregator, timeout=t)
    elif p == "hierarchy":
        res = hierarchical.run(task, providers=provs, director=args.director, aggregator=args.aggregator, timeout=t)
    elif p == "graph":
        if not args.spec and not args.nodes:
            ap.error("graph needs --spec <graph.json> (typed nodes) or --nodes/--edges")
        res = graph.run(task, nodes=args.nodes, edges=args.edges, spec=args.spec,
                        timeout=t, approve=args.approve, max_workers=args.max_workers,
                        dry_run=args.plan)
    elif p == "kg":
        res = {"pattern": "kg", **kgraph.run(
            op=args.op, name=args.graph_name, question=(args.question or task),
            spec=args.spec, source=args.source, as_of=args.as_of, k=args.hops,
            apply=args.apply, head=args.head, rel=args.rel, tail=args.tail)}
    elif p == "flow":
        if not args.flow_dsl:
            ap.error("flow needs --flow \"a -> b, c\"")
        unknown = flow.validate(args.flow_dsl)
        if unknown:
            ap.error(f"flow references unknown agents: {unknown} (use codex/copilot/opencode/grok)")
        res = flow.run(task, args.flow_dsl, timeout=t)
    elif p == "refine":
        res = refine.run(task, generator=args.generator, evaluator=args.evaluator,
                         threshold=args.threshold, max_rounds=args.rounds, timeout=t)
    elif p == "bestof":
        res = bestof.run(task, provider=args.provider, samples=args.samples, timeout=t)
    elif p == "reflexion":
        res = reasoning.reflexion(args.provider, task, iterations=args.iterations, timeout=t)
    elif p == "selfconsist":
        res = reasoning.self_consistency(args.provider, task, samples=args.samples, timeout=t)
    elif p == "gkp":
        res = reasoning.gkp(args.provider, task, timeout=t)
    elif p == "ladder":
        res = ladder.run(task, gate_cmd=gate_cmd, cwd=args.cwd,
                         confidence_threshold=args.confidence, timeout=t)
    elif p == "speclock":
        res = speclock.run(task, contract_author=args.contract_author,
                           gate_cmd=gate_cmd, cwd=args.cwd, timeout=t)
    elif p == "breaker":
        res = builder_breaker.run(task, builder=args.builder, breaker=args.breaker,
                                  rounds=args.rounds, gate_cmd=gate_cmd, cwd=args.cwd, timeout=t)
    elif p == "ballot":
        res = ballot.run(task, providers=provs, gate_cmd=gate_cmd, cwd=args.cwd, timeout=t)
    elif p == "gate":
        cmd = gate_cmd or gatemod.detect_gate_command(args.cwd or ".")
        res = {"pattern": "gate", **gatemod.run_gate(cmd, cwd=args.cwd)}
    elif p == "metaloop":
        try:
            res = _metaloop_report(task, args)
        except (ContractError, ValueError) as ex:
            res = {"pattern": "metaloop", "error": str(ex)}
    elif p == "roster":
        res = _roster_report(args)
    elif p == "hive":
        try:
            from . import hive as hivemod
        except ImportError as ex:
            res = {"pattern": "hive", "error": f"hive module not available: {ex}"}
        else:
            captains = [x.strip() for x in args.captains.split(",") if x.strip()] or None
            try:
                res = hivemod.run(
                    task,
                    spec=None,
                    spec_file=args.spec or None,
                    architect=args.architect,
                    children_per_captain=args.children,
                    captains=captains,
                    dry_run=args.dry_run,
                    timeout=t,
                    state_dir=args.state_dir,
                )
            except Exception as ex:
                res = {"pattern": "hive", "error": str(ex)}
    elif p == "designer":
        try:
            from . import designer as designermod
        except ImportError as ex:
            res = {"pattern": "designer", "error": f"designer module not available: {ex}"}
        else:
            if task:
                # Never dispatch. Print the design_prompt the architect would see.
                live = []
                try:
                    live = adapter.available()
                except Exception:
                    live = list(adapter.ALL_PANEL)
                prompt = designermod.design_prompt(task, live, constraints={})
                res = {"pattern": "designer", "prompt": prompt, "dispatched": False}
            else:
                catalog = [t.to_dict() if hasattr(t, "to_dict") else t
                           for t in designermod.catalog()]
                res = {"pattern": "designer", "catalog": catalog, "dispatched": False}
    elif p == "factory":
        try:
            from . import factory as factorymod
        except ImportError as ex:
            res = {"pattern": "factory", "error": f"factory module not available: {ex}"}
        else:
            try:
                res = factorymod.run(
                    task,
                    dry_run=args.dry_run,
                    timeout=t,
                    state_dir=args.state_dir,
                    spec_file=args.spec or None,
                    architect=args.architect,
                )
            except Exception as ex:
                res = {"pattern": "factory", "error": str(ex)}
    elif p == "board":
        res = {
            "pattern": "board",
            "error": "use python -m fusion_swarm.board --db PATH <init|register|post|dm|reply|poll|mentions|agents|tree|heartbeat|join|channels|ack>",
        }
    else:  # unreachable (argparse choices)
        ap.error(f"unknown pattern {p}")
        return 2

    # A plan/lint pass and a store operation are not runs — recording them would
    # pollute the ledger with entries that never dispatched a panelist.
    _no_record = p in ("gate", "metaloop", "roster", "kg", "designer", "board") or (
        p == "graph" and not res.get("ran")) or (
        p in ("hive", "factory") and (args.dry_run or res.get("dry_run") or res.get("error") or res.get("design")))
    if not args.no_record and not _no_record:
        adapter.record_run(_ledger_record(p, res))

    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        _pretty(p, res)
    return 0


if __name__ == "__main__":
    sys.exit(main())
