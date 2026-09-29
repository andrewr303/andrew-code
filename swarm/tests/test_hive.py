"""Offline unit tests for fusion_swarm.hive. No CLIs, no network, no paid calls.

Run:  python -m unittest tests.test_hive      (from the plugin root)
  or: python tests/test_hive.py
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
import tempfile
import unittest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm.board import HiveBoard  # noqa: E402
from fusion_swarm.hive import HiveError, main as hive_main, run  # noqa: E402


def _ids(agents):
    return {a["id"] for a in agents}


def _by_role(agents, role):
    return [a for a in agents if a["role"] == role]


def _children_of(tree, parent_id):
    return list((tree.get("children") or {}).get(parent_id) or [])


class TestHiveDryRun(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="fusion-hive-")
        self.state = self._tmp.name

    def tearDown(self):
        self._tmp.cleanup()

    def _run(self, task="ship the nested hive", **kw):
        kw.setdefault("dry_run", True)
        kw.setdefault("state_dir", self.state)
        return run(task, **kw)

    def test_result_contract_keys(self):
        res = self._run()
        for key in (
            "pattern", "run_id", "board_path", "spec", "agents",
            "tree", "posts_seeded", "dry_run",
        ):
            self.assertIn(key, res)
        self.assertEqual(res["pattern"], "hive")
        self.assertTrue(res["dry_run"])
        self.assertTrue(res["run_id"].startswith("hive-"))
        self.assertTrue(os.path.isfile(res["board_path"]))
        self.assertTrue(os.path.isfile(res["board_path"] + ".jsonl"))

    def test_default_muse_and_glm_each_have_four_children(self):
        res = self._run()
        agents = res["agents"]
        ids = _ids(agents)
        self.assertIn("arch", ids)
        self.assertIn("operator", ids)
        self.assertIn("muse", ids)
        self.assertIn("glm", ids)

        muse_kids = [f"muse-{i}" for i in range(1, 5)]
        glm_kids = [f"glm-{i}" for i in range(1, 5)]
        for kid in muse_kids + glm_kids:
            self.assertIn(kid, ids, f"missing child {kid}")

        tree = res["tree"]
        muse_children = _children_of(tree, "muse")
        glm_children = _children_of(tree, "glm")
        self.assertEqual(len(muse_children), 4)
        self.assertEqual(len(glm_children), 4)
        self.assertEqual({c["id"] for c in muse_children}, set(muse_kids))
        self.assertEqual({c["id"] for c in glm_children}, set(glm_kids))

        for kid in muse_children + glm_children:
            self.assertEqual(kid["provider"], "andrewcode")
            self.assertEqual(kid["role"], "child")
            self.assertEqual(kid["depth"], 2)

        muse = next(a for a in agents if a["id"] == "muse")
        glm = next(a for a in agents if a["id"] == "glm")
        self.assertEqual(muse["role"], "captain")
        self.assertEqual(muse["provider"], "andrewcode")
        self.assertEqual(muse["model"], "muse-spark-1.3")
        self.assertEqual(glm["role"], "captain")
        self.assertEqual(glm["provider"], "opencode")
        self.assertEqual(glm["model"], "glm-5.3")

        # glm's children are andrewcode even though the captain is opencode.
        # They run the AndrewCode worker model, not glm-5.3 (that stays on the captain).
        from fusion_swarm.hive import DEFAULT_CHILD_MODEL  # noqa: PLC0415
        for kid in glm_children:
            self.assertEqual(kid["provider"], "andrewcode")
            self.assertEqual(kid["model"], DEFAULT_CHILD_MODEL)
            self.assertEqual(kid["parent_id"], "glm")
            self.assertNotEqual(kid["model"], glm["model"])

        # 2 captains * 4 children + architect + operator = 12
        self.assertEqual(len(agents), 12)

    def test_sqlite_wal_and_default_channels(self):
        res = self._run()
        conn = sqlite3.connect(res["board_path"])
        try:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
            self.assertEqual(str(mode).lower(), "wal")
            names = {r[0] for r in conn.execute("SELECT name FROM channels")}
        finally:
            conn.close()
        for ch in ("hive", "architect", "captains", "workers", "system",
                   "task-main", "lineage-muse", "lineage-glm"):
            self.assertIn(ch, names)

    def test_task_seeded_from_architect_on_hive(self):
        task = "build the nested hive board"
        res = self._run(task)
        posts = res["posts_seeded"]
        self.assertGreaterEqual(len(posts), 1)
        hive_posts = [p for p in posts if p["channel"] == "hive"]
        self.assertTrue(hive_posts)
        self.assertEqual(hive_posts[0]["from_agent"], "arch")
        self.assertEqual(hive_posts[0]["body"], task)

        with HiveBoard(res["board_path"]) as board:
            feed = board.poll("muse-1")
        bodies = [m["body"] for m in feed]
        self.assertIn(task, bodies)

    def test_cross_lineage_dm_between_muse_and_glm_children(self):
        res = self._run()
        with HiveBoard(res["board_path"]) as board:
            msg = board.dm("muse-1", "glm-2", "need the glm tests")
            self.assertEqual(msg["from_agent"], "muse-1")
            self.assertEqual(msg["to_agent"], "glm-2")
            self.assertTrue(msg["channel"].startswith("dm:"))
            # Canonical sorted pair.
            self.assertEqual(msg["channel"], "dm:glm-2:muse-1")

            incoming = board.poll("glm-2")
            ids = {m["id"] for m in incoming}
            self.assertIn(msg["id"], ids)
            mentions = board.mentions("glm-2")
            self.assertTrue(any(m["id"] == msg["id"] for m in mentions))

            # Reply path still works across lineage.
            reply = board.reply("glm-2", msg["id"], "on it")
            self.assertEqual(reply["from_agent"], "glm-2")
            back = board.poll("muse-1")
            self.assertTrue(any(m["id"] == reply["id"] for m in back))

    def test_joins_hive_lineage_and_workers(self):
        res = self._run()
        with HiveBoard(res["board_path"]) as board:
            conn = board._conn
            members = conn.execute(
                "SELECT channel, agent_id FROM channel_members"
            ).fetchall()
        joined = {}
        for channel, agent_id in members:
            joined.setdefault(agent_id, set()).add(channel)

        for kid in ("muse-1", "muse-4", "glm-1", "glm-4"):
            rooms = joined[kid]
            self.assertIn("hive", rooms)
            self.assertIn("workers", rooms)
            self.assertIn("task-main", rooms)
        self.assertIn("lineage-muse", joined["muse-1"])
        self.assertIn("lineage-glm", joined["glm-1"])
        self.assertNotIn("lineage-glm", joined["muse-1"])
        self.assertIn("captains", joined["muse"])
        self.assertIn("captains", joined["glm"])
        self.assertIn("hive", joined["arch"])
        self.assertIn("architect", joined["arch"])

    def test_no_subprocess_on_dry_run(self):
        res = self._run()
        self.assertNotIn("spawned", res)
        self.assertTrue(res["dry_run"])

    def test_empty_task_fails_closed(self):
        with self.assertRaises(HiveError):
            run("", dry_run=True, state_dir=self.state)
        with self.assertRaises(HiveError):
            run("   ", dry_run=True, state_dir=self.state)

    def test_unknown_architect_fails_closed(self):
        with self.assertRaises(HiveError):
            run("x", architect="wizard", dry_run=True, state_dir=self.state)

    def test_children_per_captain_override(self):
        res = self._run(children_per_captain=2)
        tree = res["tree"]
        self.assertEqual(len(_children_of(tree, "muse")), 2)
        self.assertEqual(len(_children_of(tree, "glm")), 2)
        self.assertIn("muse-1", _ids(res["agents"]))
        self.assertNotIn("muse-3", _ids(res["agents"]))

    def test_captains_csv_override(self):
        res = self._run(captains="muse,glm,grok")
        ids = _ids(res["agents"])
        self.assertIn("muse", ids)
        self.assertIn("glm", ids)
        self.assertIn("grok", ids)
        self.assertEqual(len(_children_of(res["tree"], "grok")), 4)
        grok_kids = _children_of(res["tree"], "grok")
        for kid in grok_kids:
            self.assertEqual(kid["provider"], "andrewcode")

    def test_spawn_limits_refuse_fifth_child(self):
        with self.assertRaises(HiveError):
            self._run(children_per_captain=5)

    def test_live_without_spec_returns_design_packet(self):
        res = run("design me a swarm", dry_run=False, state_dir=self.state)
        self.assertTrue(res.get("design"))
        self.assertIn("design_prompt", res)
        self.assertIn("roster", res)
        self.assertIn("constraints", res)
        self.assertNotIn("board_path", res)
        self.assertIn("SwarmSpec", res["design_prompt"])

    def test_spec_dict_is_honoured(self):
        spec = {
            "name": "custom",
            "architect": {"provider": "codex", "model": "gpt-6-astra"},
            "operator": {"provider": "codex", "model": "in-context"},
            "captains": [
                {"id": "muse", "provider": "andrewcode", "model": "muse-spark-1.3",
                 "spawn": 2, "spawn_via": "andrewcode"},
                {"id": "glm", "provider": "opencode", "model": "glm-5.3",
                 "spawn": 2, "spawn_via": "opencode"},
            ],
            "cross_talk": True,
            "board": True,
            "max_depth": 2,
            "max_children_per_agent": 4,
            "max_agents": 24,
            "communication": "open",
            "task": "from spec",
        }
        res = self._run("ignored-because-spec-has-task-field-but-run-uses-arg", spec=spec)
        self.assertEqual(len(_children_of(res["tree"], "muse")), 2)
        arch = next(a for a in res["agents"] if a["id"] == "arch")
        self.assertEqual(arch["provider"], "codex")
        self.assertEqual(arch["model"], "gpt-6-astra")

    def test_spec_file_json(self):
        spec = {
            "name": "nested-hive",
            "architect": {"provider": "fable", "model": "fable-5.1"},
            "captains": [
                {"id": "muse", "provider": "andrewcode", "model": "muse-spark-1.3",
                 "spawn": 1, "spawn_via": "andrewcode"},
            ],
            "max_depth": 2,
            "max_children_per_agent": 4,
            "max_agents": 24,
        }
        path = os.path.join(self.state, "spec.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(spec, fh)
        res = self._run(spec_file=path)
        self.assertIn("muse", _ids(res["agents"]))
        self.assertEqual(len(_children_of(res["tree"], "muse")), 1)
        self.assertNotIn("glm", _ids(res["agents"]))

    def test_cli_dry_run_prints_json(self):
        argv = [
            "cli-task",
            "--dry-run",
            "--state-dir", self.state,
            "--json",
        ]
        from io import StringIO
        buf = StringIO()
        old = sys.stdout
        try:
            sys.stdout = buf
            rc = hive_main(argv)
        finally:
            sys.stdout = old
        self.assertEqual(rc, 0)
        data = json.loads(buf.getvalue())
        self.assertEqual(data["pattern"], "hive")
        self.assertTrue(data["dry_run"])
        self.assertIn("muse-1", _ids(data["agents"]))
        self.assertIn("glm-4", _ids(data["agents"]))

    def test_live_run_without_spawn_module_fails_closed(self):
        """A live run with a spec must not silently skip dispatch if spawn is missing.

        If spawn.py has landed this test still passes as long as we don't
        actually invoke andrewcode: we force ImportError via a stub.
        """
        import fusion_swarm.hive as hive_mod
        orig = hive_mod._import_spawn
        spec = {
            "name": "nested-hive",
            "architect": {"provider": "fable", "model": "fable-5.1"},
            "captains": [
                {"id": "muse", "provider": "andrewcode", "model": "muse-spark-1.3",
                 "spawn": 1, "spawn_via": "andrewcode"},
            ],
        }
        hive_mod._import_spawn = lambda: None
        try:
            with self.assertRaises(HiveError):
                run("go", spec=spec, dry_run=False, state_dir=self.state)
        finally:
            hive_mod._import_spawn = orig


class TestHiveDoesNotCallPaidCLIs(unittest.TestCase):
    def test_module_does_not_import_adapter_at_top_level_for_dispatch(self):
        import fusion_swarm.hive as hive_mod
        with open(hive_mod.__file__, encoding="utf-8") as fh:
            src = fh.read()
        self.assertNotIn("from .adapter import dispatch", src)
        self.assertNotIn("adapter.dispatch", src)


if __name__ == "__main__":
    unittest.main()
