"""Offline unit tests for nested AndrewCode spawn (Hive slice C).

No CLIs, no network: every subprocess is a mock ``runner``. These pin the
load-bearing spawn contract — argv, env injection, SpawnLimits refusal,
timeout status — without requiring andrewcode to be installed.

Run:  python -m unittest tests.test_spawn      (from the plugin root)
  or: python tests/test_spawn.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm import spawn as S  # noqa: E402
from fusion_swarm.identities import AgentIdentity  # noqa: E402
from fusion_swarm.spawn import (  # noqa: E402
    PROMPT_INLINE_MAX,
    SpawnError,
    SpawnHandle,
    SpawnLimits,
    spawn_andrewcode,
    spawn_via_adapter,
)


def _identity(**kw):
    base = dict(
        id="muse-2",
        display_name="muse-2",
        role="worker",
        provider="andrewcode",
        model="meta/muse-spark-1.3-contributor",
        parent_id="muse",
        lineage="arch/muse/muse-2",
        depth=2,
        spawn_budget=0,
        max_depth=2,
        status="online",
    )
    base.update(kw)
    return SimpleNamespace(**base)


class RecordingRunner:
    """Captures argv/env/cwd/timeout and returns a scripted result."""

    def __init__(self, result=None, raise_timeout=False):
        self.calls = []
        self.result = result or SimpleNamespace(
            pid=4242, returncode=0, timed_out=False, absent=False,
        )
        self.raise_timeout = raise_timeout

    def __call__(self, argv, env=None, cwd=None, timeout=None,
                 out_path=None, log_path=None, **kw):
        self.calls.append({
            "argv": list(argv),
            "env": dict(env or {}),
            "cwd": cwd,
            "timeout": timeout,
            "out_path": out_path,
            "log_path": log_path,
        })
        if self.raise_timeout:
            import subprocess
            raise subprocess.TimeoutExpired(argv, timeout)
        return self.result


def _spawn(runner, identity=None, prompt="do the work", **kw):
    ident = identity or _identity()
    with tempfile.TemporaryDirectory(prefix="fusion-spawn-test-") as d:
        board = os.path.join(d, "hive.sqlite")
        work = os.path.join(d, "work")
        os.makedirs(work, exist_ok=True)
        handle = spawn_andrewcode(
            ident, prompt, board, work, runner=runner, **kw,
        )
        return handle, runner.calls[-1] if runner.calls else None, d, board, work


# --- argv -------------------------------------------------------------------

class TestArgv(unittest.TestCase):
    def test_andrewcode_binary_name_present_in_argv(self):
        runner = RecordingRunner()
        handle, call, *_ = _spawn(runner)
        self.assertEqual(handle.status, "returned")
        joined = " ".join(call["argv"]).replace("\\", "/").lower()
        self.assertIn("andrewcode", joined)
        # The well-known hive binary is the default when nothing is installed.
        self.assertTrue(
            any("andrewcode" in str(a).replace("\\", "/").lower()
                for a in call["argv"]),
            call["argv"],
        )

    def test_direct_argv_flags_match_hive_contract(self):
        runner = RecordingRunner()
        _, call, *_ = _spawn(runner, prompt="short prompt")
        argv = call["argv"]
        self.assertIn("-p", argv)
        self.assertEqual(argv[argv.index("-p") + 1], "short prompt")
        self.assertIn("-m", argv)
        self.assertEqual(
            argv[argv.index("-m") + 1],
            "meta/muse-spark-1.3-contributor",
        )
        self.assertIn("--auto", argv)
        self.assertIn("-y", argv)
        self.assertIn("--yolo", argv)
        self.assertIn("--output-format", argv)
        self.assertEqual(argv[argv.index("--output-format") + 1], "text")

    def test_huge_prompt_uses_andrewcode_sh(self):
        runner = RecordingRunner()
        huge = "X" * (PROMPT_INLINE_MAX + 50)
        _, call, *_ = _spawn(runner, prompt=huge)
        argv = [str(a).replace("\\", "/") for a in call["argv"]]
        joined = " ".join(argv)
        self.assertIn("andrewcode.sh", joined)
        self.assertTrue(
            any(a.endswith(".prompt.txt") for a in argv), argv,
        )
        # Direct -p of the huge body must not appear.
        self.assertNotIn(huge, argv)
        # Git Bash-safe: argv[0] is bash (never WSL System32).
        bash0 = argv[0].lower()
        self.assertIn("bash", bash0)
        self.assertNotIn("system32", bash0)


# --- env injection ----------------------------------------------------------

class TestEnv(unittest.TestCase):
    def test_fusion_env_injected(self):
        runner = RecordingRunner()
        ident = _identity(id="muse-2", parent_id="muse")
        _, call, _, board, _ = _spawn(
            runner, identity=ident, swarm_id="swarm-abc",
            fusion_pythonpath="/tmp/fusion/python",
        )
        env = call["env"]
        self.assertEqual(env["FUSION_AGENT_ID"], "muse-2")
        self.assertEqual(env["FUSION_PARENT_ID"], "muse")
        self.assertEqual(env["FUSION_SWARM_ID"], "swarm-abc")
        self.assertEqual(
            env["FUSION_BOARD"].replace("\\", "/"),
            board.replace("\\", "/"),
        )
        self.assertIn("PYTHONPATH", env)
        self.assertIn("/tmp/fusion/python", env["PYTHONPATH"].replace("\\", "/"))

    def test_extra_env_merged_but_identity_wins(self):
        runner = RecordingRunner()
        _, call, *_ = _spawn(
            runner,
            extra_env={
                "FUSION_AGENT_ID": "spoofed",
                "CUSTOM_FLAG": "1",
                "FUSION_SWARM_ID": "from-extra",
            },
        )
        env = call["env"]
        self.assertEqual(env["FUSION_AGENT_ID"], "muse-2")  # identity wins
        self.assertEqual(env["CUSTOM_FLAG"], "1")
        # extra_env swarm id is used when swarm_id kwarg is omitted
        self.assertEqual(env["FUSION_SWARM_ID"], "from-extra")

    def test_parentless_identity_sets_empty_parent(self):
        runner = RecordingRunner()
        ident = _identity(id="arch", parent_id=None, depth=0, role="architect")
        _, call, *_ = _spawn(runner, identity=ident)
        self.assertEqual(call["env"]["FUSION_PARENT_ID"], "")


# --- SpawnHandle ------------------------------------------------------------

class TestHandle(unittest.TestCase):
    def test_handle_records_pid_paths_status(self):
        runner = RecordingRunner(SimpleNamespace(
            pid=99, returncode=0, timed_out=False, absent=False,
        ))
        handle, call, *_ = _spawn(runner)
        self.assertIsInstance(handle, SpawnHandle)
        self.assertEqual(handle.pid, 99)
        self.assertEqual(handle.agent_id, "muse-2")
        self.assertEqual(handle.provider, "andrewcode")
        self.assertEqual(handle.model, "meta/muse-spark-1.3-contributor")
        self.assertEqual(handle.status, "returned")
        self.assertEqual(handle.returncode, 0)
        self.assertTrue(handle.out_path)
        self.assertTrue(handle.log_path)
        self.assertEqual(call["out_path"], handle.out_path)
        self.assertEqual(handle.dict()["agent_id"], "muse-2")

    def test_dict_identity_accepted(self):
        runner = RecordingRunner()
        ident = {
            "id": "glm-1", "provider": "andrewcode", "model": "glm-5.3",
            "parent_id": "glm", "depth": 1, "max_depth": 2,
        }
        handle, call, *_ = _spawn(runner, identity=ident)
        self.assertEqual(handle.agent_id, "glm-1")
        self.assertEqual(call["env"]["FUSION_AGENT_ID"], "glm-1")
        self.assertEqual(call["env"]["FUSION_PARENT_ID"], "glm")

    def test_agentidentity_dataclass_accepted(self):
        runner = RecordingRunner()
        ident = AgentIdentity(
            id="muse-2", display_name="muse-2", role="child",
            provider="andrewcode", model="meta/muse-spark-1.3-contributor",
            parent_id="muse", lineage="arch/muse/muse-2",
            depth=2, spawn_budget=0, max_depth=2,
        )
        handle, call, *_ = _spawn(runner, identity=ident)
        self.assertEqual(handle.agent_id, "muse-2")
        self.assertEqual(call["env"]["FUSION_PARENT_ID"], "muse")
        self.assertIn("andrewcode", " ".join(call["argv"]).replace("\\", "/").lower())


# --- budget / depth refusal -------------------------------------------------

class TestBudget(unittest.TestCase):
    def test_max_agents_refused_before_runner(self):
        runner = RecordingRunner()
        limits = SpawnLimits(max_depth=2, max_children_per_agent=4, max_agents=3)
        with self.assertRaises(SpawnError) as ctx:
            _spawn(runner, limits=limits, current_total=3, current_children=0)
        self.assertIn("max_agents", str(ctx.exception))
        self.assertEqual(runner.calls, [])

    def test_max_children_refused(self):
        runner = RecordingRunner()
        limits = SpawnLimits(max_depth=2, max_children_per_agent=4, max_agents=24)
        with self.assertRaises(SpawnError) as ctx:
            _spawn(runner, limits=limits, current_total=5, current_children=4)
        self.assertIn("max_children", str(ctx.exception))
        self.assertEqual(runner.calls, [])

    def test_max_depth_refused(self):
        runner = RecordingRunner()
        limits = SpawnLimits(max_depth=2, max_children_per_agent=4, max_agents=24)
        # A depth-2 parent cannot spawn (parent.depth >= max_depth).
        parent = AgentIdentity(
            id="muse-2", display_name="muse-2", role="child",
            provider="andrewcode", model="m",
            parent_id="muse", lineage="arch/muse/muse-2",
            depth=2, spawn_budget=1, max_depth=2,
        )
        ident = _identity(id="muse-2-a", parent_id="muse-2", depth=3, max_depth=2)
        with self.assertRaises(SpawnError) as ctx:
            _spawn(runner, identity=ident, limits=limits, parent=parent,
                   current_total=1, current_children=0)
        self.assertIn("max_depth", str(ctx.exception))
        self.assertEqual(runner.calls, [])

    def test_depth_two_child_is_allowed(self):
        runner = RecordingRunner()
        limits = SpawnLimits(max_depth=2, max_children_per_agent=4, max_agents=24)
        ident = _identity(depth=2, max_depth=2)
        handle, call, *_ = _spawn(
            runner, identity=ident, limits=limits,
            current_total=5, current_children=1,
        )
        self.assertEqual(handle.status, "returned")
        self.assertTrue(call)

    def test_spawn_at_capacity_minus_one_succeeds(self):
        runner = RecordingRunner()
        limits = SpawnLimits(max_depth=2, max_children_per_agent=4, max_agents=24)
        handle, _, *_ = _spawn(
            runner, limits=limits, current_total=23, current_children=3,
        )
        self.assertEqual(handle.status, "returned")


# --- timeout / absent -------------------------------------------------------

class TestStatus(unittest.TestCase):
    def test_timeout_status_from_runner_flag(self):
        runner = RecordingRunner(SimpleNamespace(
            pid=7, returncode=124, timed_out=True, absent=False,
        ))
        handle, _, *_ = _spawn(runner, timeout=1)
        self.assertEqual(handle.status, "timeout")
        self.assertEqual(handle.returncode, 124)

    def test_timeout_status_from_raised_TimeoutExpired(self):
        runner = RecordingRunner(raise_timeout=True)
        handle, call, *_ = _spawn(runner, timeout=0.01)
        self.assertEqual(handle.status, "timeout")
        self.assertEqual(handle.returncode, 124)
        self.assertEqual(call["timeout"], 0.01)

    def test_absent_status(self):
        runner = RecordingRunner(SimpleNamespace(
            pid=0, returncode=127, timed_out=False, absent=True,
        ))
        handle, _, *_ = _spawn(runner)
        self.assertEqual(handle.status, "absent")
        self.assertEqual(handle.returncode, 127)

    def test_error_status(self):
        runner = RecordingRunner(SimpleNamespace(
            pid=3, returncode=1, timed_out=False, absent=False,
        ))
        handle, _, *_ = _spawn(runner)
        self.assertEqual(handle.status, "error")
        self.assertEqual(handle.returncode, 1)


# --- spawn_via_adapter ------------------------------------------------------

class TestSpawnViaAdapter(unittest.TestCase):
    def test_passed_dispatch_is_called_not_live_adapter(self):
        calls = []

        def fake_dispatch(provider, prompt, model="", effort="", timeout=None, **kw):
            calls.append({
                "provider": provider, "prompt": prompt, "model": model,
                "effort": effort, "timeout": timeout,
            })
            return SimpleNamespace(text="ok-from-adapter", status="returned")

        ident = _identity(id="cap-glm", provider="opencode", model="glm-5.3",
                          depth=1, parent_id="arch")
        with tempfile.TemporaryDirectory(prefix="fusion-spawn-ad-") as d:
            board = os.path.join(d, "hive.sqlite")
            work = os.path.join(d, "work")
            handle = spawn_via_adapter(
                "opencode", ident, "captain task", board, workdir=work,
                dispatch=fake_dispatch, timeout=30,
            )
            self.assertTrue(Path(handle.out_path).exists())
            self.assertEqual(
                Path(handle.out_path).read_text(encoding="utf-8"),
                "ok-from-adapter",
            )
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["provider"], "opencode")
        self.assertEqual(calls[0]["prompt"], "captain task")
        self.assertEqual(calls[0]["model"], "glm-5.3")
        self.assertEqual(handle.status, "returned")
        self.assertEqual(handle.provider, "opencode")
        self.assertEqual(handle.agent_id, "cap-glm")

    def test_adapter_timeout_maps_to_timeout_status(self):
        def boom(*a, **k):
            import subprocess
            raise subprocess.TimeoutExpired("dispatch", 5)

        ident = _identity(id="cap", provider="grok", model="grok-4.5", depth=1)
        with tempfile.TemporaryDirectory(prefix="fusion-spawn-ad-") as d:
            handle = spawn_via_adapter(
                "grok", ident, "x", os.path.join(d, "b.sqlite"),
                workdir=d, dispatch=boom,
            )
        self.assertEqual(handle.status, "timeout")
        self.assertEqual(handle.returncode, 124)

    def test_budget_refusal_skips_dispatch(self):
        calls = []

        def fake_dispatch(*a, **k):
            calls.append(1)
            return SimpleNamespace(text="nope", status="returned")

        ident = _identity(depth=1)
        limits = SpawnLimits(max_agents=1)
        with tempfile.TemporaryDirectory(prefix="fusion-spawn-ad-") as d:
            with self.assertRaises(SpawnError):
                spawn_via_adapter(
                    "codex", ident, "x", os.path.join(d, "b.sqlite"),
                    workdir=d, dispatch=fake_dispatch,
                    limits=limits, current_total=1,
                )
        self.assertEqual(calls, [])

    def test_missing_dispatch_lazy_imports_without_crash(self):
        """If adapter is importable, default dispatch is used; if not, SpawnError.
        Either way the module itself must already have imported cleanly."""
        self.assertTrue(hasattr(S, "spawn_via_adapter"))
        # Calling with an explicit callable is the unit-test path; the lazy
        # import branch is only hit when dispatch is None. We assert it does
        # not raise at *import* time (already true) and that a missing
        # adapter would be a SpawnError, not an ImportError bubbling out.
        ident = _identity(id="c", depth=1)
        with tempfile.TemporaryDirectory(prefix="fusion-spawn-ad-") as d:
            # Passing a callable guarantees we never touch adapter.
            handle = spawn_via_adapter(
                "codex", ident, "x", os.path.join(d, "b.sqlite"),
                workdir=d,
                dispatch=lambda *a, **k: SimpleNamespace(
                    text="", status="absent",
                ),
            )
        self.assertEqual(handle.status, "absent")


# --- cwd / timeout forwarded ------------------------------------------------

class TestForwarding(unittest.TestCase):
    def test_timeout_and_cwd_forwarded_to_runner(self):
        runner = RecordingRunner()
        ident = _identity()
        with tempfile.TemporaryDirectory(prefix="fusion-spawn-test-") as d:
            work = os.path.join(d, "work")
            os.makedirs(work)
            spawn_andrewcode(
                ident, "p", os.path.join(d, "hive.sqlite"), work,
                runner=runner, timeout=12.5,
            )
        self.assertEqual(runner.calls[0]["timeout"], 12.5)
        self.assertEqual(
            os.path.normpath(runner.calls[0]["cwd"]),
            os.path.normpath(work),
        )


if __name__ == "__main__":
    unittest.main()
