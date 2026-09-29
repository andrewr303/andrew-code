"""Codefusion CLI — one entrypoint for every coding agent you have installed."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Optional

from codefusion import __version__
from codefusion.branding import PRODUCT, TAGLINE
from codefusion.config import (
    CORE_MODES,
    SWARM_PATTERNS,
    load_config,
    save_config,
)
from codefusion.detect import clear_degraded, detect_report
from codefusion.ledger import learn_summary
from codefusion.metaloop import diagram_text, format_metaloop, run_metaloop
from codefusion.orchestrator import format_run_summary, run_task
from codefusion.paths import ensure_vendor_paths, project_state_dir, state_dir
from codefusion.pm_bridge import pm_doctor, puppetmaster_available, run_pm_main
from codefusion.router import format_route, route
from codefusion.subagents import categories, format_subagent_list, list_subagents
from codefusion.swarm import format_swarm_result, run_pattern, swarm_available


def _print(msg: str) -> None:
    sys.stdout.write(msg if msg.endswith("\n") else msg + "\n")


def cmd_version(_: argparse.Namespace) -> int:
    cfg = load_config()
    _print(f"{PRODUCT} {__version__}")
    _print(f"architecture: Meta LOOP (Plan→Delegate→Verify→Synthesize)")
    _print(f"orchestrator: {cfg.orchestrator_provider} / {cfg.orchestrator_model} ({cfg.orchestrator_effort})")
    _print(f"advisor: {cfg.metaloop_advisor_label} via {cfg.metaloop_advisor_provider} (off hot path)")
    _print(
        f"labor: {cfg.metaloop_worker_count}× {cfg.metaloop_worker_provider} "
        f"({cfg.metaloop_worker_model})"
    )
    return 0


def cmd_doctor(args: argparse.Namespace) -> int:
    ensure_vendor_paths()
    _print(detect_report(as_json=bool(args.json)))
    if not args.json:
        _print("")
        _print(pm_doctor())
        _print(f"fusion_swarm: {'available' if swarm_available() else 'unavailable'}")
        _print(f"state: {state_dir()}")
        _print(f"project: {project_state_dir()}")
    return 0


def cmd_setup(args: argparse.Namespace) -> int:
    cfg = load_config()
    if args.model:
        cfg.orchestrator_model = args.model
    if args.host:
        cfg.orchestrator_provider = args.host
    if args.effort:
        cfg.orchestrator_effort = args.effort
    path = save_config(cfg)
    state_dir().mkdir(parents=True, exist_ok=True)
    (state_dir() / "memory").mkdir(parents=True, exist_ok=True)
    project_state_dir().mkdir(parents=True, exist_ok=True)
    if args.clear_degraded:
        clear_degraded()
    _print(f"{PRODUCT} setup complete")
    _print(f"  config: {path}")
    _print(f"  conductor: {cfg.orchestrator_provider} / {cfg.orchestrator_model}")
    _print("")
    _print(detect_report())
    _print("")
    _print("Next:")
    _print(f'  codefusion run "Review this repo architecture"')
    _print("  codefusion dashboard")
    _print("  codefusion modes")
    return 0


def cmd_route(args: argparse.Namespace) -> int:
    task = args.task or ""
    if args.task_file:
        task = Path(args.task_file).read_text(encoding="utf-8")
    if not task.strip():
        _print("usage: codefusion route \"<task>\"", )
        return 2
    decision = route(task, force_mode=args.mode)
    if args.json:
        _print(json.dumps(decision.dict(), indent=2))
    else:
        _print(format_route(decision))
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    task = args.task or ""
    if args.task_file:
        task = Path(args.task_file).read_text(encoding="utf-8")
    if not task.strip() and not sys.stdin.isatty():
        task = sys.stdin.read()
    if not task.strip():
        _print(
            'usage: codefusion run "<task>" '
            "[--mode metaloop|panel|council|debate|vote|swarm|solo]"
        )
        return 2

    providers = None
    if args.providers:
        providers = [p.strip() for p in args.providers.split(",") if p.strip()]

    mode = getattr(args, "mode", "auto")
    result = run_task(
        task,
        mode=mode,
        providers=providers,
        cwd=Path(args.cwd).resolve() if args.cwd else None,
        synthesize=not args.no_synthesize,
        run_conductor=not args.no_conductor,
        timeout=args.timeout,
        consult_advisor=bool(getattr(args, "advisor", False)),
        force_advisor=bool(getattr(args, "force_advisor", False)),
        worker_count=getattr(args, "workers", None),
    )
    if args.json:
        _print(json.dumps(result, indent=2, default=str))
    elif result.get("mode") == "metaloop" or str(result.get("run_id", "")).startswith("ml_"):
        _print(format_metaloop(result))
    else:
        _print(format_run_summary(result))
    return 0 if result.get("ok") else 1


def cmd_metaloop(args: argparse.Namespace) -> int:
    """Force Meta LOOP architecture (diagram mode)."""
    if getattr(args, "diagram", False):
        _print(diagram_text())
        return 0
    task = args.task or ""
    if args.task_file:
        task = Path(args.task_file).read_text(encoding="utf-8")
    if not task.strip() and not sys.stdin.isatty():
        task = sys.stdin.read()
    if not task.strip():
        _print('usage: codefusion metaloop "<task>" [--advisor] [--workers N]')
        _print("")
        _print(diagram_text())
        return 2
    result = run_metaloop(
        task,
        consult_advisor=bool(args.advisor),
        force_advisor=bool(args.force_advisor),
        worker_count=args.workers,
        cwd=Path(args.cwd).resolve() if args.cwd else None,
        timeout=args.timeout,
        run_orchestrator=not args.no_conductor,
    )
    if args.json:
        _print(json.dumps(result, indent=2, default=str))
    else:
        _print(format_metaloop(result))
    return 0 if result.get("ok") else 1


def cmd_swarm(args: argparse.Namespace) -> int:
    task = args.task or ""
    if args.task_file:
        task = Path(args.task_file).read_text(encoding="utf-8")
    if args.pattern == "gate" and not args.gate_cmd and task:
        args.gate_cmd = task
        task = task
    if args.pattern != "gate" and not task.strip():
        _print(f'usage: codefusion swarm {args.pattern} "<task>"')
        return 2
    extra = {
        "layers": args.layers,
        "rounds": args.rounds,
        "loops": args.loops,
        "samples": args.samples,
        "iterations": args.iterations,
        "provider": args.provider,
        "generator": args.generator,
        "evaluator": args.evaluator,
        "director": args.director,
        "builder": args.builder,
        "breaker": args.breaker,
        "threshold": args.threshold,
        "flow": args.flow,
        "nodes": args.nodes,
        "edges": args.edges,
        "contract_author": args.contract_author,
        "cwd": args.cwd,
    }
    res = run_pattern(
        args.pattern,
        task,
        providers=args.providers,
        timeout=args.timeout,
        gate_cmd=args.gate_cmd or "",
        extra=extra,
    )
    if args.json:
        _print(json.dumps(res, indent=2, default=str))
    else:
        _print(format_swarm_result(args.pattern, res))
    return 0 if res.get("ok", True) and not res.get("error") else 1


def cmd_dashboard(args: argparse.Namespace) -> int:
    from codefusion.dashboard import open_dashboard, serve_local
    from codefusion.pm_bridge import start_dashboard as pm_start

    if args.pm or (args.job and puppetmaster_available()):
        res = pm_start(
            args.job,
            port=args.port,
            host=args.host,
            open_browser=not args.no_open,
            background=args.background,
            all_projects=args.all_projects,
        )
        if not res.get("ok"):
            _print(res.get("error") or "dashboard failed")
            if not args.local:
                _print("Falling back to local Codefusion board…")
            else:
                return 1
        else:
            if res.get("url"):
                _print(f"{PRODUCT} board (Puppetmaster) → {res['url']}")
            return 0

    if args.background:
        res = open_dashboard(
            port=args.port,
            host=args.host,
            open_browser=not args.no_open,
            background=True,
            prefer_pm=False,
        )
        _print(json.dumps(res) if args.json else f"{PRODUCT} board → {res.get('url')}")
        return 0 if res.get("ok") else 1

    serve_local(host=args.host, port=args.port, open_browser=not args.no_open)
    return 0


def cmd_learn(_: argparse.Namespace) -> int:
    _print(learn_summary())
    return 0


def cmd_modes(_: argparse.Namespace) -> int:
    _print(f"{PRODUCT} collaboration modes")
    _print("")
    _print("Primary architecture — Meta LOOP (see: codefusion metaloop --diagram):")
    _print("  metaloop   Orchestrator GPT-5.6 hot path + optional Fable 5 advisor")
    _print("             + parallel cheap labor (Gemini Flash workers)")
    _print("             Plan → Delegate → Verify → Synthesize (± Escalate)")
    _print("")
    _print("Peer Fusion modes (when you want multi-model panels, not labor hierarchy):")
    for m in CORE_MODES:
        if m == "metaloop":
            continue
        _print(f"  {m}")
    _print("")
    _print("Swarm patterns (Fusion / Fusion-ML engine):")
    for m in SWARM_PATTERNS:
        _print(f"  {m}")
    _print("")
    _print("Routing prefers Meta LOOP for real work; peer modes for research/debate.")
    _print("Cost-first model routing is NOT used.")
    return 0


def cmd_agents(args: argparse.Namespace) -> int:
    if args.subagents or args.query or args.family or args.category:
        agents = list_subagents(
            family=args.family,
            category=args.category,
            query=args.query,
            limit=args.limit,
        )
        if args.json:
            _print(json.dumps([a.dict() for a in agents], indent=2))
        else:
            _print(format_subagent_list(agents))
            if args.categories:
                _print("")
                _print("Categories:")
                for fam, cats in categories().items():
                    _print(f"  {fam}: {', '.join(cats)}")
        return 0
    # CLI agents
    _print(detect_report(as_json=bool(args.json)))
    return 0


def cmd_pm(args: argparse.Namespace) -> int:
    """Passthrough to Puppetmaster durable-job CLI (codefusion pm …)."""
    return run_pm_main(args.pm_args or [])


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="codefusion",
        description=f"{PRODUCT} — {TAGLINE}",
    )
    p.add_argument("--version", action="store_true", help="print version")
    sub = p.add_subparsers(dest="command")

    # doctor
    d = sub.add_parser("doctor", help="detect installed coding agents")
    d.add_argument("--json", action="store_true")
    d.set_defaults(func=cmd_doctor)

    # setup
    s = sub.add_parser("setup", help="write config + seed state")
    s.add_argument("--model", help="orchestrator model (default gpt-5.6)")
    s.add_argument("--host", help="host conductor provider (default codex)")
    s.add_argument("--effort", help="orchestrator effort (default xhigh)")
    s.add_argument("--clear-degraded", action="store_true")
    s.set_defaults(func=cmd_setup)

    # route
    r = sub.add_parser("route", help="advise collaboration mode (no LLM cost router)")
    r.add_argument("task", nargs="?", default="")
    r.add_argument("--task-file")
    r.add_argument("--mode", default="auto")
    r.add_argument("--json", action="store_true")
    r.set_defaults(func=cmd_route)

    # run
    run_p = sub.add_parser(
        "run",
        help="run Codefusion (defaults to Meta LOOP for real work)",
    )
    run_p.add_argument("task", nargs="?", default="")
    run_p.add_argument("--task-file")
    run_p.add_argument(
        "--mode",
        default="auto",
        help="auto|metaloop|solo|panel|council|debate|vote|swarm",
    )
    run_p.add_argument("--providers", help="comma list, e.g. grok,opencode,agy")
    run_p.add_argument("--cwd")
    run_p.add_argument("--timeout", type=int, default=None)
    run_p.add_argument("--workers", type=int, default=None, help="Meta LOOP labor count")
    run_p.add_argument("--advisor", action="store_true", help="consult Fable 5 board advisor")
    run_p.add_argument("--force-advisor", action="store_true")
    run_p.add_argument("--no-synthesize", action="store_true")
    run_p.add_argument("--no-conductor", action="store_true", help="skip orchestrator subprocess")
    run_p.add_argument("--json", action="store_true")
    run_p.set_defaults(func=cmd_run)

    # Meta LOOP — primary architecture (diagram)
    ml = sub.add_parser(
        "metaloop",
        help="Meta LOOP: Orchestrator GPT-5.6 + optional Fable 5 advisor + cheap parallel labor",
    )
    ml.add_argument("task", nargs="?", default="")
    ml.add_argument("--task-file")
    ml.add_argument("--workers", type=int, default=None)
    ml.add_argument("--advisor", action="store_true", help="force Board Advisor consult")
    ml.add_argument("--force-advisor", action="store_true")
    ml.add_argument("--cwd")
    ml.add_argument("--timeout", type=int, default=None)
    ml.add_argument("--no-conductor", action="store_true")
    ml.add_argument("--diagram", action="store_true", help="print architecture diagram")
    ml.add_argument("--json", action="store_true")
    ml.set_defaults(func=cmd_metaloop)

    # Convenience mode aliases (skip metaloop — has dedicated parser above)
    for mode_name in CORE_MODES:
        if mode_name in {"solo", "metaloop"}:
            continue
        mp = sub.add_parser(mode_name, help=f"force mode={mode_name}")
        mp.add_argument("task", nargs="?", default="")
        mp.add_argument("--task-file")
        mp.add_argument("--providers")
        mp.add_argument("--cwd")
        mp.add_argument("--timeout", type=int, default=None)
        mp.add_argument("--no-synthesize", action="store_true")
        mp.add_argument("--no-conductor", action="store_true")
        mp.add_argument("--json", action="store_true")

        def _make(mode: str):
            def _fn(args: argparse.Namespace, __mode=mode) -> int:
                args.mode = __mode
                args.advisor = False
                args.force_advisor = False
                args.workers = None
                return cmd_run(args)

            return _fn

        mp.set_defaults(func=_make(mode_name))

    def _add_pattern_parser(name: str, help_text: str) -> None:
        sw = sub.add_parser(name, help=help_text)
        sw.add_argument("pattern", choices=list(SWARM_PATTERNS))
        sw.add_argument("task", nargs="?", default="")
        sw.add_argument("--task-file")
        sw.add_argument("--providers")
        sw.add_argument("--timeout", type=int, default=None)
        sw.add_argument("--gate-cmd", default="")
        sw.add_argument("--layers", type=int, default=2)
        sw.add_argument("--rounds", type=int, default=2)
        sw.add_argument("--loops", type=int, default=1)
        sw.add_argument("--samples", type=int, default=5)
        sw.add_argument("--iterations", type=int, default=2)
        sw.add_argument("--provider", default="codex")
        sw.add_argument("--generator", default="codex")
        sw.add_argument("--evaluator", default="grok")
        sw.add_argument("--director", default="codex")
        sw.add_argument("--builder", default="opencode")
        sw.add_argument("--breaker", default="grok")
        sw.add_argument("--threshold", type=int, default=80)
        sw.add_argument("--flow", default="")
        sw.add_argument("--nodes")
        sw.add_argument("--edges")
        sw.add_argument("--contract-author", default="codex")
        sw.add_argument("--cwd")
        sw.add_argument("--json", action="store_true")
        sw.set_defaults(func=cmd_swarm)

    # Fusion-ML advanced patterns (not the core "swarm" mode)
    _add_pattern_parser("pattern", "run a Fusion/Fusion-ML swarm pattern (moa, heavy, breaker, …)")
    _add_pattern_parser("fusion", "alias for pattern — Fusion/Fusion-ML engine")

    # dashboard
    dash = sub.add_parser("dashboard", help="live board for swarms / runs")
    dash.add_argument("job", nargs="?", default=None, help="Puppetmaster job id (optional)")
    dash.add_argument("--port", type=int, default=8787)
    dash.add_argument("--host", default="127.0.0.1")
    dash.add_argument("--no-open", action="store_true")
    dash.add_argument("--background", "-b", action="store_true")
    dash.add_argument("--pm", action="store_true", help="force Puppetmaster durable board")
    dash.add_argument("--local", action="store_true", help="force local Codefusion runs board")
    dash.add_argument("--all-projects", action="store_true")
    dash.add_argument("--json", action="store_true")
    dash.set_defaults(func=cmd_dashboard)

    # learn
    ln = sub.add_parser("learn", help="show ledger winners / panelist stats")
    ln.set_defaults(func=cmd_learn)

    # modes
    md = sub.add_parser("modes", help="list collaboration modes")
    md.set_defaults(func=cmd_modes)

    # agents / subagents
    ag = sub.add_parser("agents", help="list CLI agents or subagent catalog")
    ag.add_argument("--subagents", action="store_true", help="list role subagents")
    ag.add_argument("--query", "-q")
    ag.add_argument("--family", choices=["claude", "codex"])
    ag.add_argument("--category")
    ag.add_argument("--categories", action="store_true")
    ag.add_argument("--limit", type=int, default=100)
    ag.add_argument("--json", action="store_true")
    ag.set_defaults(func=cmd_agents)

    # pm passthrough
    pm = sub.add_parser("pm", help="Puppetmaster durable-job CLI passthrough")
    pm.add_argument("pm_args", nargs=argparse.REMAINDER)
    pm.set_defaults(func=cmd_pm)

    # version subcommand
    ver = sub.add_parser("version", help="print version")
    ver.set_defaults(func=cmd_version)

    return p


def main(argv: Optional[list[str]] = None) -> int:
    ensure_vendor_paths()
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    if not argv:
        parser.print_help()
        _print("")
        _print(f"  {TAGLINE}")
        return 0
    # allow `codefusion --version`
    if argv == ["--version"] or argv == ["-V"]:
        return cmd_version(argparse.Namespace())
    args = parser.parse_args(argv)
    if getattr(args, "version", False) and not getattr(args, "command", None):
        return cmd_version(args)
    func = getattr(args, "func", None)
    if func is None:
        parser.print_help()
        return 0
    try:
        return int(func(args) or 0)
    except KeyboardInterrupt:
        _print("\ninterrupted")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
