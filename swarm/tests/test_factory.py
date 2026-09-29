"""Offline unit tests for the factory alias (slice R).

No CLIs, no network, no paid calls. factory.run(..., dry_run=True) must
build a hive tree + board without subprocess.

Run:  python -m unittest tests.test_factory      (from the plugin root)
  or: python tests/test_factory.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from unittest import mock

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm.designer import SwarmSpec, validate_spec  # noqa: E402
from fusion_swarm.factory import (  # noqa: E402
    CHILDREN_PER_CAPTAIN,
    PHASES,
    factory_captains,
    factory_spec,
    run,
)

_TOPOLOGIES = os.path.join(
    _ROOT, "skills", "fusion-graph", "references", "topologies.md"
)

_LIVE_ROSTER = [
    "fable", "codex", "grok", "copilot", "opencode", "andrewcode",
]


def _read_topologies() -> str:
    with open(_TOPOLOGIES, encoding="utf-8") as fh:
        return fh.read()


class TestFactorySpec(unittest.TestCase):
    def test_phases_are_discover_define_develop_deliver(self):
        self.assertEqual(PHASES, ("discover", "define", "develop", "deliver"))

    def test_empty_task_fails_closed(self):
        with self.assertRaises(ValueError):
            factory_spec("")
        with self.assertRaises(ValueError):
            factory_spec("   ")

    def test_four_captains_each_spawn_two_andrewcode_children(self):
        spec = factory_spec("ship the module")
        self.assertEqual(spec.name, "factory")
        self.assertEqual([c.id for c in spec.captains], list(PHASES))
        self.assertEqual(len(spec.captains), 4)
        for cap in spec.captains:
            self.assertEqual(cap.spawn, 2)
            self.assertEqual(cap.spawn_via, "andrewcode")
            self.assertTrue(cap.provider)
            self.assertTrue(cap.model)

    def test_open_board_and_cross_talk(self):
        spec = factory_spec("ship the module")
        self.assertTrue(spec.board)
        self.assertTrue(spec.cross_talk)
        self.assertEqual(spec.communication, "open")
        self.assertEqual(spec.max_depth, 2)
        # Architect fans out 4 captains; each captain still spawn=2.
        self.assertGreaterEqual(spec.max_children_per_agent, 4)
        self.assertEqual(spec.max_agents, 24)
        self.assertTrue(all(c.spawn == 2 for c in spec.captains))

    def test_architect_and_operator_seats(self):
        spec = factory_spec("ship the module")
        self.assertIsNotNone(spec.architect)
        self.assertEqual(spec.architect.provider, "fable")
        self.assertEqual(spec.operator.provider, "codex")

    def test_validates_against_live_roster(self):
        spec = factory_spec("ship the module")
        self.assertEqual(validate_spec(spec, _LIVE_ROSTER), [])

    def test_spawn_override_zero(self):
        spec = factory_spec("ship the module", spawn=0)
        self.assertTrue(all(c.spawn == 0 for c in spec.captains))

    def test_spawn_above_budget_fails_closed(self):
        with self.assertRaises(ValueError):
            factory_captains(spawn=5)

    def test_to_dict_round_trip(self):
        spec = factory_spec("ship the module")
        again = SwarmSpec.from_dict(spec.to_dict())
        self.assertEqual(again.name, "factory")
        self.assertEqual([c.id for c in again.captains], list(PHASES))


class TestFactoryRunWrapper(unittest.TestCase):
    def test_run_passes_factory_spec_and_dry_run_to_hive(self):
        captured = {}

        def fake_run(task, spec=None, spec_file=None, architect="fable",
                     children_per_captain=4, captains=None, dry_run=False,
                     timeout=None, state_dir=None, **kw):
            captured.update(
                task=task, spec=spec, dry_run=dry_run, architect=architect,
                children_per_captain=children_per_captain, timeout=timeout,
                state_dir=state_dir, spec_file=spec_file, captains=captains,
            )
            return {
                "pattern": "hive",
                "run_id": "run-test",
                "board_path": "/tmp/board.sqlite",
                "spec": spec.to_dict() if hasattr(spec, "to_dict") else spec,
                "agents": [],
                "tree": {},
                "posts_seeded": 1,
                "dry_run": dry_run,
            }

        from fusion_swarm import hive as hive_mod

        with mock.patch.object(hive_mod, "run", fake_run):
            result = run("build the thing", dry_run=True)

        self.assertEqual(captured["task"], "build the thing")
        self.assertTrue(captured["dry_run"])
        spec = captured["spec"]
        self.assertIsInstance(spec, SwarmSpec)
        self.assertEqual(spec.name, "factory")
        self.assertEqual([c.id for c in spec.captains], list(PHASES))
        self.assertTrue(all(c.spawn == CHILDREN_PER_CAPTAIN for c in spec.captains))
        self.assertEqual(result["pattern"], "factory")
        self.assertTrue(result["dry_run"])
        self.assertEqual(result["posts_seeded"], 1)

    def test_run_does_not_subprocess_when_hive_is_stubbed(self):
        """Honesty: the wrapper never invents CLI output itself."""
        def fake_run(*a, **kw):
            return {
                "pattern": "hive", "run_id": "x", "board_path": "b",
                "spec": {}, "agents": [], "tree": {}, "posts_seeded": 0,
                "dry_run": True,
            }

        from fusion_swarm import hive as hive_mod

        with mock.patch.object(hive_mod, "run", fake_run):
            result = run("t", dry_run=True)
        self.assertEqual(result["pattern"], "factory")
        self.assertNotIn("transcript", result)


class TestFactoryRunOffline(unittest.TestCase):
    def test_dry_run_builds_tree_and_board_without_subprocess(self):
        try:
            from fusion_swarm import hive as hive_mod  # noqa: F401
        except ImportError:
            self.skipTest("fusion_swarm.hive not landed yet")

        with tempfile.TemporaryDirectory() as tmp:
            result = run("ship a factory slice", dry_run=True, state_dir=tmp)

            self.assertIsInstance(result, dict)
            self.assertEqual(result.get("pattern"), "factory")
            self.assertTrue(result.get("dry_run"))
            self.assertIn("run_id", result)
            self.assertIn("board_path", result)
            self.assertTrue(result["board_path"])
            self.assertTrue(
                os.path.isfile(result["board_path"]), result["board_path"]
            )
            self.assertTrue(
                os.path.isfile(result["board_path"] + ".jsonl"),
                result["board_path"] + ".jsonl",
            )
            self.assertIn("agents", result)
            self.assertIn("tree", result)
            self.assertIn("posts_seeded", result)
            self.assertIn("spec", result)

            spec = result["spec"]
            if isinstance(spec, SwarmSpec):
                spec = spec.to_dict()
            self.assertEqual(spec["name"], "factory")
            self.assertEqual(
                [c["id"] for c in spec["captains"]],
                list(PHASES),
            )
            for cap in spec["captains"]:
                self.assertEqual(cap["spawn"], 2)
                self.assertEqual(cap["spawn_via"], "andrewcode")
            self.assertTrue(spec["board"])
            self.assertEqual(spec["communication"], "open")

            agent_ids = {
                (a["id"] if isinstance(a, dict) else getattr(a, "id"))
                for a in result["agents"]
            }
            for phase in PHASES:
                self.assertIn(phase, agent_ids)
                self.assertIn(f"{phase}-1", agent_ids)
                self.assertIn(f"{phase}-2", agent_ids)
            self.assertIn("arch", agent_ids)
            self.assertIn("operator", agent_ids)

            # 4 captains × 2 children = 8 nested workers, plus architect/operator.
            self.assertGreaterEqual(len(result["agents"]), 2 + 4 + 8)
            self.assertTrue(result["posts_seeded"])


class TestTopologiesSection7(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read_topologies()

    def test_sections_1_through_6_still_present(self):
        for heading in (
            "## 1. Fan-out",
            "## 2. Fan-in at a barrier",
            "## 3. The diamond",
            "## 4. Routing",
            "## 5. Verification",
            "## 6. Cycles that converge",
        ):
            self.assertIn(heading, self.text)

    def test_section_7_nested_hive(self):
        self.assertIn("## 7. Nested-hive", self.text)
        low = self.text.lower()
        self.assertIn("hive board", low)
        self.assertIn("andrewcode", low)
        self.assertIn("factory", low)
        self.assertIn("discover", low)
        self.assertIn("define", low)
        self.assertIn("develop", low)
        self.assertIn("deliver", low)
        self.assertIn("open", low)

    def test_section_7_is_appended_not_a_rewrite(self):
        # The six named patterns table and sources block must still exist
        # after section 7 is appended.
        self.assertIn("## The six named patterns", self.text)
        self.assertIn("## Sources for the pattern set", self.text)
        pos7 = self.text.index("## 7. Nested-hive")
        pos_sources = self.text.index("## Sources for the pattern set")
        self.assertGreater(pos7, pos_sources)


if __name__ == "__main__":
    unittest.main()
