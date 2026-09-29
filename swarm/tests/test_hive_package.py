"""Slice H — Python package wiring for nested hive.

Offline unittest. No live paid CLI calls. Covers __init__ exports, argparse
patterns (hive/designer/board), modes_catalog, and adapter roster changes.
"""
from __future__ import annotations

import io
import json
import os
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm import adapter, modes_catalog  # noqa: E402
from fusion_swarm import __main__ as swarm_main  # noqa: E402


class TestPackageExports(unittest.TestCase):
    def test_all_lists_hive_modules(self):
        import fusion_swarm as pkg
        for name in (
            "board", "identities", "spawn", "designer",
            "hive", "hive_prompts", "lanes", "factory",
        ):
            self.assertIn(name, pkg.__all__, name)

    def test_present_hive_modules_are_importable(self):
        import fusion_swarm as pkg
        for name in (
            "board", "identities", "spawn", "designer",
            "hive", "hive_prompts", "lanes", "factory",
        ):
            self.assertTrue(hasattr(pkg, name), f"expected fusion_swarm.{name}")
            self.assertIsNotNone(getattr(pkg, name))

    def test_existing_exports_still_present(self):
        import fusion_swarm as pkg
        for name in ("adapter", "moa", "heavy", "metaloop", "kgraph", "ballot"):
            self.assertTrue(hasattr(pkg, name), name)


class TestModesCatalog(unittest.TestCase):
    def test_engine_patterns_include_hive_family(self):
        for p in ("hive", "designer", "board"):
            self.assertIn(p, modes_catalog.ENGINE_PATTERNS)

    def test_existing_engine_patterns_untouched(self):
        for p in (
            "moa", "heavy", "discuss", "hierarchy", "graph", "flow", "refine",
            "bestof", "reflexion", "selfconsist", "gkp", "ladder", "speclock",
            "breaker", "ballot", "gate", "metaloop", "kg",
        ):
            self.assertIn(p, modes_catalog.ENGINE_PATTERNS)

    def test_provider_names_include_new_clis(self):
        for p in ("andrewcode", "fable", "agy", "kimi"):
            self.assertIn(p, modes_catalog.PROVIDER_NAMES)

    def test_hive_roster(self):
        self.assertEqual(
            tuple(modes_catalog.engine_providers("hive")),
            ("andrewcode", "fable", "codex", "opencode", "grok", "agy"),
        )

    def test_designer_and_board_dispatch_no_panelist(self):
        self.assertEqual(modes_catalog.engine_providers("designer"), [])
        self.assertEqual(modes_catalog.engine_providers("board"), [])

    def test_hive_providers_are_known(self):
        for p in modes_catalog.ENGINE_PATTERN_PROVIDERS["hive"]:
            self.assertIn(p, modes_catalog.PROVIDER_NAMES)

    def test_base_panel_unchanged(self):
        # Existing panel patterns must not silently grow andrewcode.
        self.assertEqual(
            modes_catalog.BASE_PANEL,
            ("codex", "copilot", "opencode", "grok"),
        )
        self.assertEqual(modes_catalog.engine_providers("moa"), list(modes_catalog.BASE_PANEL))


class TestAdapterRoster(unittest.TestCase):
    def test_all_panel_includes_andrewcode(self):
        self.assertIn("andrewcode", adapter.ALL_PANEL)
        for p in ("codex", "copilot", "opencode", "grok"):
            self.assertIn(p, adapter.ALL_PANEL)

    def test_default_panel_stays_legacy_four(self):
        self.assertNotIn("andrewcode", adapter.DEFAULT_PANEL)
        for p in ("codex", "copilot", "opencode", "grok"):
            if p != adapter.FUSION_HOST:
                self.assertIn(p, adapter.DEFAULT_PANEL)

    def test_andrewcode_nested_capacity(self):
        self.assertEqual(adapter.WORKER_SESSIONS["andrewcode"], 4)

    def test_andrewcode_stays_muse_expert(self):
        meta = adapter.PROVIDER_META["andrewcode"]
        self.assertEqual(meta["tier"], "expert")
        self.assertEqual(meta["model_family"], "muse")
        self.assertEqual(meta["harness"], "andrewcode-cli")

    def test_codex_strengths_note_astra(self):
        strengths = " ".join(adapter.PROVIDER_META["codex"]["strengths"]).lower()
        self.assertIn("astra", strengths)
        self.assertIn("gpt-6-astra", strengths)


class TestBuildParser(unittest.TestCase):
    def setUp(self):
        self.ap = swarm_main.build_parser()

    def test_new_patterns_accepted(self):
        for p in ("hive", "designer", "board", "factory"):
            args = self.ap.parse_args([p, "do the thing"])
            self.assertEqual(args.pattern, p)

    def test_existing_pattern_still_parses(self):
        args = self.ap.parse_args(["moa", "task", "--layers", "3"])
        self.assertEqual(args.pattern, "moa")
        self.assertEqual(args.layers, 3)

    def test_dry_run_flag(self):
        args = self.ap.parse_args(["hive", "task", "--dry-run"])
        self.assertTrue(args.dry_run)
        args = self.ap.parse_args(["hive", "task"])
        self.assertFalse(args.dry_run)

    def test_hive_flags(self):
        args = self.ap.parse_args([
            "hive", "task",
            "--spec", "spec.json",
            "--children", "3",
            "--captains", "andrewcode,opencode",
            "--architect", "codex",
        ])
        self.assertEqual(args.spec, "spec.json")
        self.assertEqual(args.children, 3)
        self.assertEqual(args.captains, "andrewcode,opencode")
        self.assertEqual(args.architect, "codex")

    def test_unknown_pattern_rejected(self):
        buf = io.StringIO()
        with self.assertRaises(SystemExit), redirect_stderr(buf):
            self.ap.parse_args(["not-a-pattern", "task"])


class TestMainBranches(unittest.TestCase):
    def _run(self, argv):
        buf = io.StringIO()
        err = io.StringIO()
        with redirect_stdout(buf), redirect_stderr(err):
            rc = swarm_main.main(argv)
        return rc, buf.getvalue(), err.getvalue()

    def test_board_redirects_without_task(self):
        rc, out, err = self._run(["board", "--json"])
        self.assertEqual(rc, 0, err)
        data = json.loads(out)
        self.assertEqual(data["pattern"], "board")
        self.assertIn("python -m fusion_swarm.board", data["error"])

    def test_designer_catalog_without_task(self):
        rc, out, err = self._run(["designer", "--json"])
        self.assertEqual(rc, 0, err)
        data = json.loads(out)
        self.assertEqual(data["pattern"], "designer")
        self.assertFalse(data.get("dispatched"))
        names = {c["name"] for c in data["catalog"]}
        self.assertIn("nested-hive", names)
        self.assertIn("custom", names)
        self.assertIn("panel", names)

    def test_designer_with_task_prints_prompt_not_dispatch(self):
        with mock.patch.object(adapter, "available", return_value=["codex", "andrewcode"]):
            rc, out, err = self._run(["designer", "ship nested hive", "--json"])
        self.assertEqual(rc, 0, err)
        data = json.loads(out)
        self.assertEqual(data["pattern"], "designer")
        self.assertFalse(data.get("dispatched"))
        self.assertIn("SwarmSpec", data["prompt"])
        self.assertIn("ship nested hive", data["prompt"])
        self.assertNotIn("error", data)

    def test_hive_dry_run_builds_tree(self):
        import tempfile
        with tempfile.TemporaryDirectory(prefix="fusion-hive-pkg-") as td:
            rc, out, err = self._run([
                "hive", "do work", "--dry-run", "--json", "--no-record",
                "--state-dir", td,
                "--captains", "andrewcode,opencode",
                "--children", "2",
            ])
        self.assertEqual(rc, 0, err)
        data = json.loads(out)
        self.assertEqual(data["pattern"], "hive")
        if data.get("error"):
            self.fail(f"hive dry-run error: {data['error']}")
        self.assertTrue(data.get("dry_run"))
        self.assertTrue(data.get("board_path"))
        self.assertGreaterEqual(len(data.get("agents") or []), 2)

    def test_hive_requires_task(self):
        buf = io.StringIO()
        with self.assertRaises(SystemExit), redirect_stderr(buf):
            swarm_main.main(["hive", "--dry-run"])
        self.assertIn("task is required", buf.getvalue())

    def test_hive_captains_csv_passed_through(self):
        captured = {}

        def _fake_run(task, **kw):
            captured["task"] = task
            captured.update(kw)
            return {
                "pattern": "hive", "run_id": "h1", "dry_run": True,
                "board_path": "/tmp/x.sqlite", "agents": [], "tree": {},
                "posts_seeded": 0, "spec": None,
            }

        from fusion_swarm import hive as hivemod
        with mock.patch.object(hivemod, "run", side_effect=_fake_run):
            with mock.patch(
                "fusion_swarm.__main__.adapter.record_run",
                side_effect=AssertionError("must not record dry-run"),
            ):
                rc, out, err = self._run([
                    "hive", "do work", "--dry-run", "--json", "--no-record",
                    "--captains", "andrewcode,opencode",
                    "--children", "3",
                    "--architect", "codex",
                    "--state-dir", "/tmp/hive-state",
                ])
        self.assertEqual(rc, 0, err)
        data = json.loads(out)
        self.assertEqual(data["pattern"], "hive")
        self.assertEqual(captured.get("task"), "do work")
        self.assertEqual(captured.get("captains"), ["andrewcode", "opencode"])
        self.assertEqual(captured.get("children_per_captain"), 3)
        self.assertEqual(captured.get("architect"), "codex")
        self.assertTrue(captured.get("dry_run"))
        self.assertEqual(captured.get("state_dir"), "/tmp/hive-state")


if __name__ == "__main__":
    unittest.main()
