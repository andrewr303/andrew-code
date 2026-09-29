"""Offline unit tests for fusion_swarm.comms (JSONL agent bus).

No CLIs, no network, no paid calls. Tempdir JSONL + optional sqlite board.

Run:  python -m unittest tests.test_comms      (from the swarm/ plugin root)
  or: python tests/test_comms.py
"""
from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm.agency_context import (  # noqa: E402
    MasterContext,
    persist_snapshot,
    restore_snapshot,
    session_context,
    drop_session,
    main as agency_main,
)
from fusion_swarm.comms import (  # noqa: E402
    AGENT_ROLES,
    DEFAULT_CHANNELS,
    MESSAGE_KINDS,
    CommsError,
    ack,
    append_event,
    context_clear,
    context_get,
    context_list,
    context_set,
    history,
    init_comms,
    list_agents,
    list_channel,
    list_channels,
    load_context,
    main as comms_main,
    poll_inbox,
    post_message,
    record_collision,
    replace_context,
    resolve_comms_dir,
    snapshot_context,
    summarize_comms,
    upsert_agent_card,
)


class CommsTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.cwd = self._tmp.name
        self._old_comms = os.environ.get("ANDREWCODE_COMMS_DIR")
        self._old_board = os.environ.get("FUSION_BOARD")
        os.environ.pop("ANDREWCODE_COMMS_DIR", None)
        os.environ.pop("FUSION_BOARD", None)
        self.dir = init_comms(self.cwd)

    def tearDown(self):
        if self._old_comms is None:
            os.environ.pop("ANDREWCODE_COMMS_DIR", None)
        else:
            os.environ["ANDREWCODE_COMMS_DIR"] = self._old_comms
        if self._old_board is None:
            os.environ.pop("FUSION_BOARD", None)
        else:
            os.environ["FUSION_BOARD"] = self._old_board
        drop_session("default")
        drop_session("test-session")
        self._tmp.cleanup()

    def _register(self, agent_id, role="worker", **kw):
        card = {
            "id": agent_id,
            "role": role,
            "provider": kw.pop("provider", "andrewcode"),
            "model": kw.pop("model", "muse-spark-1.3"),
            "status": kw.pop("status", "idle"),
            "capabilities": kw.pop("capabilities", []),
        }
        card.update(kw)
        return upsert_agent_card(card, cwd=self.cwd)

    def _jsonl(self, name="board.jsonl"):
        path = Path(self.dir) / name
        if not path.exists():
            return []
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]


class TestResolveAndInit(CommsTestCase):
    def test_init_creates_store_layout(self):
        root = Path(self.dir)
        self.assertTrue((root / "board.jsonl").exists())
        self.assertTrue((root / "agents.json").exists())
        self.assertTrue((root / "context.json").exists())
        self.assertTrue((root / "events.jsonl").exists())
        self.assertTrue((root / "mailbox").is_dir())
        self.assertEqual(root, Path(self.cwd) / ".andrewcode" / "comms")

    def test_override_env_wins(self):
        override = os.path.join(self.cwd, "custom-comms")
        os.environ["ANDREWCODE_COMMS_DIR"] = override
        resolved = resolve_comms_dir("/does/not/matter")
        self.assertEqual(Path(resolved), Path(override).resolve())
        init_comms()
        self.assertTrue((Path(override) / "board.jsonl").exists())

    def test_summarize_mentions_counts(self):
        text = summarize_comms(self.cwd)
        self.assertIn("comms", text)
        self.assertIn("0 agents", text)


class TestAgentCards(CommsTestCase):
    def test_upsert_and_list(self):
        card = self._register("arch", role="architect", capabilities=["plan"])
        self.assertEqual(card["id"], "arch")
        self.assertEqual(card["role"], "architect")
        self.assertEqual(card["status"], "idle")
        self.assertIn("plan", card["capabilities"])
        people = list_agents(self.cwd)
        self.assertEqual(len(people), 1)
        self.assertEqual(people[0]["id"], "arch")

    def test_upsert_merges(self):
        self._register("muse", role="captain", status="idle")
        updated = upsert_agent_card(
            {"id": "muse", "role": "captain", "status": "busy", "provider": "andrewcode"},
            cwd=self.cwd,
        )
        self.assertEqual(updated["status"], "busy")
        self.assertEqual(len(list_agents(self.cwd)), 1)

    def test_bad_role_fails_closed(self):
        with self.assertRaises(CommsError):
            upsert_agent_card({"id": "x", "role": "overlord"}, cwd=self.cwd)

    def test_human_role_allowed(self):
        card = self._register("user", role="human")
        self.assertEqual(card["role"], "human")
        self.assertIn("human", AGENT_ROLES)


class TestMessages(CommsTestCase):
    def test_post_poll_ack(self):
        self._register("arch", role="architect")
        self._register("muse", role="captain")
        msg = post_message(
            from_agent="arch",
            body="hello @muse",
            channel="hive",
            cwd=self.cwd,
        )
        self.assertEqual(msg["from"], "arch")
        self.assertEqual(msg["kind"], "message")
        self.assertIn("muse", msg["mentions"])
        self.assertIn("id", msg)
        self.assertIn("ts", msg)
        self.assertIsNone(msg["to"])
        self.assertIsNone(msg["threadId"])
        self.assertIsNone(msg["taskId"])

        inbox = poll_inbox("muse", cwd=self.cwd)
        self.assertEqual(len(inbox), 1)
        self.assertEqual(inbox[0]["body"], "hello @muse")

        acked = ack("muse", inbox[0]["id"], cwd=self.cwd)
        self.assertTrue(acked["ok"])
        self.assertEqual(poll_inbox("muse", cwd=self.cwd), [])

    def test_mailbox_isolation(self):
        self._register("arch", role="architect")
        self._register("muse", role="captain")
        self._register("child-1", role="child")
        post_message(
            from_agent="arch",
            body="captains only",
            channel="captains",
            cwd=self.cwd,
        )
        self.assertTrue(poll_inbox("muse", cwd=self.cwd))
        self.assertFalse(poll_inbox("child-1", cwd=self.cwd))

    def test_dm_routing(self):
        self._register("a", role="worker")
        self._register("b", role="worker")
        self._register("c", role="worker")
        msg = post_message(
            from_agent="a",
            body="private",
            channel="dm:a:b",
            to="b",
            cwd=self.cwd,
        )
        self.assertEqual(msg["channel"], "dm:a:b")
        self.assertEqual(len(poll_inbox("b", cwd=self.cwd)), 1)
        self.assertEqual(poll_inbox("c", cwd=self.cwd), [])

    def test_history_and_channel_list(self):
        self._register("arch", role="architect")
        post_message(from_agent="arch", body="one", channel="hive", cwd=self.cwd)
        post_message(from_agent="arch", body="two", channel="system", cwd=self.cwd)
        hive = list_channel("hive", cwd=self.cwd)
        self.assertEqual([m["body"] for m in hive], ["one"])
        all_msgs = history(cwd=self.cwd)
        self.assertEqual([m["body"] for m in all_msgs], ["one", "two"])
        names = {c["name"] for c in list_channels(self.cwd)}
        self.assertTrue(set(DEFAULT_CHANNELS) <= names)
        self.assertIn("system", names)

    def test_empty_body_and_bad_kind_fail_closed(self):
        self._register("arch", role="architect")
        with self.assertRaises(CommsError):
            post_message(from_agent="arch", body="", channel="hive", cwd=self.cwd)
        with self.assertRaises(CommsError):
            post_message(
                from_agent="arch", body="x", channel="hive", kind="whisper", cwd=self.cwd,
            )
        self.assertIn("handoff", MESSAGE_KINDS)
        self.assertIn("task", MESSAGE_KINDS)

    def test_auto_register_sender(self):
        msg = post_message(from_agent="ghost", body="hi", cwd=self.cwd)
        self.assertEqual(msg["from"], "ghost")
        ids = {a["id"] for a in list_agents(self.cwd)}
        self.assertIn("ghost", ids)

    def test_poll_since_and_limit(self):
        self._register("arch", role="architect")
        self._register("muse", role="captain")
        first = post_message(from_agent="arch", body="a", cwd=self.cwd)
        post_message(from_agent="arch", body="b", cwd=self.cwd)
        post_message(from_agent="arch", body="c", cwd=self.cwd)
        rest = poll_inbox("muse", since=first["id"], cwd=self.cwd)
        self.assertEqual([m["body"] for m in rest], ["b", "c"])
        limited = poll_inbox("muse", limit=1, cwd=self.cwd)
        self.assertEqual(len(limited), 1)

    def test_collision_event(self):
        rec = record_collision("src/app.ts", ["arch", "muse"], cwd=self.cwd)
        self.assertEqual(rec["kind"], "collision")
        self.assertEqual(rec["path"], "src/app.ts")
        events = self._jsonl("events.jsonl")
        self.assertTrue(any(e.get("kind") == "collision" for e in events))
        extra = append_event("presence", {"from": "arch", "status": "online"}, cwd=self.cwd)
        self.assertEqual(extra["kind"], "presence")


class TestContextStore(CommsTestCase):
    def test_set_get_list_clear_snapshot(self):
        set_res = context_set("phase", "collect", cwd=self.cwd)
        self.assertTrue(set_res["ok"])
        got = context_get("phase", cwd=self.cwd)
        self.assertTrue(got["found"])
        self.assertEqual(got["value"], "collect")
        listed = context_list(cwd=self.cwd)
        self.assertEqual(listed["keys"], ["phase"])
        snap = snapshot_context(cwd=self.cwd)
        self.assertIn("data", snap)
        self.assertEqual(snap["data"]["phase"], "collect")
        on_disk = json.loads((Path(self.dir) / "context.json").read_text(encoding="utf-8"))
        self.assertEqual(on_disk["data"]["phase"], "collect")
        context_clear(cwd=self.cwd)
        self.assertEqual(context_list(cwd=self.cwd)["keys"], [])

    def test_agency_context_persist_roundtrip(self):
        ctx = session_context("test-session")
        ctx.set("customer", {"id": "CUST1"})
        rec = persist_snapshot(ctx, cwd=self.cwd)
        self.assertEqual(rec["data"]["customer"]["id"], "CUST1")
        drop_session("test-session")
        restored = restore_snapshot(cwd=self.cwd, session_id="test-session")
        self.assertEqual(restored.get("customer"), {"id": "CUST1"})

    def test_replace_context_payload(self):
        rec = replace_context(
            MasterContext(_data={"k": 1}, session_id="s").to_dict(),
            cwd=self.cwd,
        )
        self.assertEqual(load_context(self.cwd)["data"]["k"], 1)
        self.assertEqual(rec["session_id"], "s")


class TestCli(CommsTestCase):
    def _run(self, *argv):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = comms_main(["--cwd", self.cwd, *argv])
        raw = buf.getvalue()
        data = json.loads(raw)
        return rc, data

    def test_cli_verbs_print_json(self):
        rc, data = self._run("init")
        self.assertEqual(rc, 0)
        self.assertTrue(data["ok"])
        self.assertEqual(list(data["channels"]), list(DEFAULT_CHANNELS))

        rc, arch = self._run(
            "register", "--id", "arch", "--role", "architect",
            "--provider", "fable", "--model", "5.1", "--status", "online",
        )
        self.assertEqual(rc, 0)
        self.assertEqual(arch["id"], "arch")

        rc, muse = self._run(
            "register", "--id", "muse", "--role", "captain",
            "--provider", "andrewcode", "--model", "muse-spark-1.3",
        )
        self.assertEqual(rc, 0)

        rc, posted = self._run(
            "post", "--from", "arch", "--body", "go @muse", "--channel", "hive",
        )
        self.assertEqual(rc, 0)
        self.assertEqual(posted["body"], "go @muse")
        self.assertIn("muse", posted["mentions"])

        rc, inbox = self._run("poll", "--agent", "muse")
        self.assertEqual(rc, 0)
        self.assertTrue(any(m["body"] == "go @muse" for m in inbox))

        rc, acked = self._run("ack", "--agent", "muse", "--id", inbox[0]["id"])
        self.assertEqual(rc, 0)
        self.assertTrue(acked["ok"])

        rc, agents = self._run("agents")
        self.assertEqual(rc, 0)
        self.assertEqual({a["id"] for a in agents}, {"arch", "muse"})

        rc, chans = self._run("channels")
        self.assertEqual(rc, 0)
        self.assertTrue(any(c["name"] == "hive" for c in chans))

        rc, hist = self._run("history", "--channel", "hive")
        self.assertEqual(rc, 0)
        self.assertEqual(hist[0]["body"], "go @muse")

        rc, listed = self._run("context", "list")
        self.assertEqual(rc, 0)
        self.assertEqual(listed["keys"], [])

        rc, setted = self._run("context", "set", "phase", "ready")
        self.assertEqual(rc, 0)
        self.assertEqual(setted["value"], "ready")

        rc, got = self._run("context", "get", "phase")
        self.assertEqual(rc, 0)
        self.assertEqual(got["value"], "ready")

        rc, snap = self._run("context", "snapshot")
        self.assertEqual(rc, 0)
        self.assertEqual(snap["data"]["phase"], "ready")

        rc, cleared = self._run("context", "clear")
        self.assertEqual(rc, 0)
        self.assertTrue(cleared["cleared"])

        rc, col = self._run(
            "collision", "--path", "a.ts", "--agents", "arch,muse",
        )
        self.assertEqual(rc, 0)
        self.assertEqual(col["kind"], "collision")

    def test_cli_error_is_json(self):
        rc, data = self._run("post", "--from", "arch", "--body", "", "--channel", "hive")
        self.assertEqual(rc, 1)
        self.assertFalse(data["ok"])
        self.assertIn("error", data)

    def test_cli_json_value_roundtrip(self):
        rc, data = self._run("context", "set", "blob", '{"n": 3}')
        self.assertEqual(rc, 0)
        self.assertEqual(data["value"], {"n": 3})

    def test_agency_context_cli_persists(self):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = agency_main(["--cwd", self.cwd, "set", "k", "v"])
        self.assertEqual(rc, 0)
        data = json.loads(buf.getvalue())
        self.assertEqual(data["value"], "v")
        on_disk = json.loads((Path(self.dir) / "context.json").read_text(encoding="utf-8"))
        self.assertEqual(on_disk["data"]["k"], "v")


class TestHiveBoardBridge(CommsTestCase):
    def test_post_reuses_hive_board_when_env_set(self):
        from fusion_swarm.board import HiveBoard

        db = os.path.join(self.cwd, "hive.sqlite")
        os.environ["FUSION_BOARD"] = db
        with HiveBoard(db) as board:
            board.register({
                "id": "arch",
                "display_name": "arch",
                "role": "architect",
                "provider": "fable",
                "model": "5.1",
                "status": "online",
            })
            board.register({
                "id": "muse",
                "display_name": "muse",
                "role": "captain",
                "provider": "andrewcode",
                "model": "muse-spark-1.3",
                "status": "online",
            })
        self._register("arch", role="architect", provider="fable", model="5.1")
        self._register("muse", role="captain")
        msg = post_message(
            from_agent="arch",
            body="via hive",
            channel="hive",
            cwd=self.cwd,
        )
        self.assertIn("hiveId", msg)
        with HiveBoard(db) as board:
            feed = board.poll("muse")
            board.post(from_agent="arch", body="board-only", channel="hive")
        self.assertTrue(any(m["body"] == "via hive" for m in feed))
        inbox = poll_inbox("muse", cwd=self.cwd)
        bodies = [m["body"] for m in inbox]
        self.assertIn("via hive", bodies)
        self.assertIn("board-only", bodies)
        self.assertEqual(bodies.count("via hive"), 1)


class TestContextShExists(unittest.TestCase):
    def test_wrapper_is_executable_script(self):
        path = os.path.join(_ROOT, "scripts", "context.sh")
        self.assertTrue(os.path.isfile(path))
        text = Path(path).read_text(encoding="utf-8")
        self.assertIn("fusion_swarm.comms", text)
        self.assertIn("context", text)

    def test_context_sh_arg_order(self):
        # context.sh runs: python -m fusion_swarm.comms context "$@"
        with tempfile.TemporaryDirectory() as tmp:
            buf = io.StringIO()
            with redirect_stdout(buf):
                rc = comms_main(["context", "--cwd", tmp, "set", "k", "1"])
            self.assertEqual(rc, 0)
            data = json.loads(buf.getvalue())
            self.assertEqual(data["key"], "k")
            stored = json.loads(
                (Path(tmp) / ".andrewcode" / "comms" / "context.json").read_text(encoding="utf-8")
            )
            self.assertEqual(stored["data"]["k"], 1)

    def _run_context_sh(self, cwd, extra_args):
        import shutil
        import subprocess

        bash = shutil.which("bash")
        if bash is None:
            self.skipTest("bash not on PATH")
        script = os.path.join(_ROOT, "scripts", "context.sh")
        return subprocess.run(
            [bash, script, *extra_args],
            cwd=cwd,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )

    def test_context_sh_subprocess(self):
        with tempfile.TemporaryDirectory() as tmp:
            proc = self._run_context_sh(tmp, ["set", "phase", "collect"])
            self.assertEqual(proc.returncode, 0, proc.stderr)
            data = json.loads(proc.stdout)
            self.assertTrue(data.get("ok"))
            self.assertEqual(data.get("key"), "phase")
            self.assertEqual(data.get("value"), "collect")
            stored = json.loads(
                (Path(tmp) / ".andrewcode" / "comms" / "context.json").read_text(encoding="utf-8")
            )
            self.assertEqual(stored["data"]["phase"], "collect")

    def test_context_sh_from_swarm_root_not_shadowed(self):
        # swarm/fusion_swarm.py is a shim; cwd=swarm must not break the wrapper.
        with tempfile.TemporaryDirectory() as tmp:
            proc = self._run_context_sh(_ROOT, ["--cwd", tmp, "set", "k", "v"])
            self.assertEqual(proc.returncode, 0, proc.stderr + proc.stdout)
            data = json.loads(proc.stdout)
            self.assertEqual(data.get("value"), "v")
            stored = json.loads(
                (Path(tmp) / ".andrewcode" / "comms" / "context.json").read_text(encoding="utf-8")
            )
            self.assertEqual(stored["data"]["k"], "v")


if __name__ == "__main__":
    unittest.main()
