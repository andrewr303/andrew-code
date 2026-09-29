"""Offline unit tests for HiveBoard (fusion_swarm.board).

No CLIs, no network, no codefusion. Tempfile sqlite + JSONL only.

Run:  python -m unittest tests.test_board      (from the plugin root)
  or: python tests/test_board.py
"""
from __future__ import annotations

import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from dataclasses import dataclass

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm.board import (  # noqa: E402
    AGENT_ROLES,
    CHANNEL_KINDS,
    DEFAULT_CHANNELS,
    BoardError,
    HiveBoard,
    main as board_main,
)


# A local stand-in for fusion_swarm.identities.AgentIdentity so this slice
# does not depend on a file another agent owns.
@dataclass
class AgentIdentity:
    id: str
    display_name: str
    role: str
    provider: str
    model: str
    parent_id: str | None = None
    lineage: str = ""
    depth: int = 0
    spawn_budget: int = 0
    max_depth: int = 2
    status: str = "online"


def _agent(i, role="worker", parent=None, lineage="", depth=0, **kw):
    return {
        "id": i,
        "display_name": kw.pop("display_name", i),
        "role": role,
        "provider": kw.pop("provider", "andrewcode"),
        "model": kw.pop("model", "muse-spark-1.3"),
        "parent_id": parent,
        "lineage": lineage,
        "depth": depth,
        **kw,
    }


class BoardTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db = os.path.join(self._tmp.name, "hive.sqlite")
        self.board = HiveBoard(self.db)

    def tearDown(self):
        self.board.close()
        self._tmp.cleanup()

    def jsonl(self):
        path = self.db + ".jsonl"
        if not os.path.exists(path):
            return []
        with open(path, encoding="utf-8") as fh:
            return [json.loads(line) for line in fh if line.strip()]


class TestInitSchema(BoardTestCase):
    def test_default_channels_exist(self):
        names = {c["name"] for c in self.board.channels()}
        self.assertEqual(names, set(DEFAULT_CHANNELS))
        for ch in self.board.channels():
            self.assertEqual(ch["kind"], "room")
            self.assertEqual(ch["created_by"], "system")

    def test_wal_journal_mode(self):
        conn = sqlite3.connect(self.db)
        try:
            mode = conn.execute("PRAGMA journal_mode").fetchone()[0]
        finally:
            conn.close()
        self.assertEqual(mode.lower(), "wal")

    def test_tables_exist(self):
        conn = sqlite3.connect(self.db)
        try:
            tables = {
                r[0]
                for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
        finally:
            conn.close()
        self.assertTrue(
            {"agents", "channels", "channel_members", "messages", "acks", "presence"}
            <= tables
        )

    def test_context_manager_closes(self):
        path = os.path.join(self._tmp.name, "other.sqlite")
        with HiveBoard(path) as b:
            b.ensure_channel("task-main", kind="task")
        # Re-open independently — WAL + no daemon.
        with HiveBoard(path) as b2:
            names = {c["name"] for c in b2.channels()}
        self.assertIn("task-main", names)

    def test_ensure_channel_kinds(self):
        for kind in CHANNEL_KINDS:
            name = f"k-{kind}"
            self.assertEqual(self.board.ensure_channel(name, kind=kind), name)
        with self.assertRaises(BoardError):
            self.board.ensure_channel("nope", kind="irc")

    def test_ensure_channel_kind_mismatch_fails_closed(self):
        self.board.ensure_channel("hive")  # already a room
        with self.assertRaises(BoardError):
            self.board.ensure_channel("hive", kind="dm")


class TestRegister(BoardTestCase):
    def test_register_dict_and_identity(self):
        rec = self.board.register(_agent("arch", role="architect", provider="codex",
                                         model="gpt-5.4"))
        self.assertEqual(rec["id"], "arch")
        self.assertEqual(rec["role"], "architect")
        ident = AgentIdentity(
            id="op", display_name="Operator", role="operator",
            provider="codex", model="gpt-5.4",
        )
        rec2 = self.board.register(ident)
        self.assertEqual(rec2["display_name"], "Operator")
        ids = {a["id"] for a in self.board.agents()}
        self.assertEqual(ids, {"arch", "op"})

    def test_register_parent_lineage(self):
        self.board.register(_agent("arch", role="architect", provider="fable", model="5.1"))
        self.board.register(_agent(
            "muse", role="captain", parent="arch", lineage="arch/muse",
            depth=1, provider="andrewcode", model="muse-spark-1.3",
        ))
        self.board.register(_agent(
            "muse-2", role="child", parent="muse", lineage="arch/muse/muse-2",
            depth=2, provider="andrewcode", model="muse-spark-1.3",
        ))
        people = {a["id"]: a for a in self.board.agents()}
        self.assertEqual(people["muse"]["parent_id"], "arch")
        self.assertEqual(people["muse-2"]["lineage"], "arch/muse/muse-2")
        self.assertEqual(people["muse-2"]["depth"], 2)

    def test_register_unknown_parent_fails_closed(self):
        with self.assertRaises(BoardError):
            self.board.register(_agent("orphan", parent="ghost"))

    def test_register_bad_role_fails_closed(self):
        with self.assertRaises(BoardError):
            self.board.register(_agent("x", role="wizard"))
        self.assertTrue("architect" in AGENT_ROLES)

    def test_heartbeat(self):
        self.board.register(_agent("arch", role="architect", provider="fable", model="5.1"))
        hb = self.board.heartbeat("arch", status="busy")
        self.assertEqual(hb["status"], "busy")
        self.assertEqual(self.board.agents()[0]["status"], "busy")
        with self.assertRaises(BoardError):
            self.board.heartbeat("nope")

    def test_tree_groups_by_parent(self):
        self.board.register(_agent("arch", role="architect", provider="fable", model="5.1"))
        self.board.register(_agent("muse", role="captain", parent="arch",
                                   lineage="arch/muse", depth=1))
        self.board.register(_agent("glm", role="captain", parent="arch",
                                   lineage="arch/glm", depth=1,
                                   provider="opencode", model="glm-5.3"))
        self.board.register(_agent("muse-1", role="child", parent="muse",
                                   lineage="arch/muse/muse-1", depth=2))
        self.board.register(_agent("glm-1", role="child", parent="glm",
                                   lineage="arch/glm/glm-1", depth=2,
                                   provider="andrewcode", model="muse-spark-1.3"))
        tree = self.board.tree()
        self.assertEqual([r["id"] for r in tree["roots"]], ["arch"])
        self.assertEqual(
            sorted(c["id"] for c in tree["children"]["arch"]),
            ["glm", "muse"],
        )
        self.assertEqual([c["id"] for c in tree["children"]["muse"]], ["muse-1"])
        self.assertEqual([c["id"] for c in tree["children"]["glm"]], ["glm-1"])


class TestPostAndPoll(BoardTestCase):
    def _roster(self):
        self.board.register(_agent("arch", role="architect", provider="fable", model="5.1"))
        self.board.register(_agent("muse", role="captain", parent="arch",
                                   lineage="arch/muse", depth=1))
        self.board.register(_agent("glm", role="captain", parent="arch",
                                   lineage="arch/glm", depth=1,
                                   provider="opencode", model="glm-5.3"))
        self.board.register(_agent("muse-1", role="child", parent="muse",
                                   lineage="arch/muse/muse-1", depth=2))
        self.board.register(_agent("glm-1", role="child", parent="glm",
                                   lineage="arch/glm/glm-1", depth=2))

    def test_post_to_hive(self):
        self._roster()
        msg = self.board.post(from_agent="arch", body="kickoff", channel="hive")
        self.assertEqual(msg["id"], 1)
        self.assertEqual(msg["channel"], "hive")
        self.assertEqual(msg["body"], "kickoff")
        self.assertEqual(msg["mentions"], [])
        feed = self.board.poll("muse-1")
        self.assertEqual(len(feed), 1)
        self.assertEqual(feed[0]["body"], "kickoff")

    def test_jsonl_appended(self):
        self._roster()
        self.board.post(from_agent="arch", body="one", channel="hive")
        self.board.post(from_agent="muse", body="two", channel="hive")
        lines = self.jsonl()
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0]["body"], "one")
        self.assertEqual(lines[1]["body"], "two")
        self.assertEqual(lines[0]["id"], 1)

    def test_dm_between_children_of_different_captains(self):
        self._roster()
        dm = self.board.dm("muse-1", "glm-1", "cross-lineage ping")
        self.assertTrue(dm["channel"].startswith("dm:"))
        # Canonical name is sorted ids.
        self.assertEqual(dm["channel"], "dm:glm-1:muse-1")
        self.assertEqual(dm["to_agent"], "glm-1")
        muse_feed = self.board.poll("muse-1")
        glm_feed = self.board.poll("glm-1")
        self.assertTrue(any(m["body"] == "cross-lineage ping" for m in muse_feed))
        self.assertTrue(any(m["body"] == "cross-lineage ping" for m in glm_feed))
        # Captains do not see the children's DM (poll isolation).
        muse_cap = self.board.poll("muse")
        self.assertFalse(any(m["body"] == "cross-lineage ping" for m in muse_cap))

    def test_thread_reply(self):
        self._roster()
        root = self.board.post(from_agent="arch", body="plan", channel="hive")
        reply = self.board.reply("muse", root["id"], "ack the plan")
        self.assertEqual(reply["thread_id"], root["id"])
        self.assertEqual(reply["channel"], "hive")
        nested = self.board.reply("glm", reply["id"], "nested")
        # Nested replies attach to the root thread, not the reply.
        self.assertEqual(nested["thread_id"], root["id"])

    def test_mentions(self):
        self._roster()
        self.board.ensure_channel("captains")
        # Posted in captains — workers are not members.
        self.board.post(
            from_agent="muse",
            body="need a worker",
            channel="captains",
            mentions=["glm-1"],
        )
        hits = self.board.mentions("glm-1")
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["mentions"], ["glm-1"])
        # Poll still delivers the mention even though glm-1 never joined captains.
        feed = self.board.poll("glm-1")
        self.assertTrue(any(m["mentions"] == ["glm-1"] for m in feed))
        # muse-1 was not mentioned and is not in captains.
        self.assertEqual(self.board.mentions("muse-1"), [])
        self.assertFalse(any("need a worker" in m["body"] for m in self.board.poll("muse-1")))

    def test_poll_isolation_joined_plus_dms_plus_mentions(self):
        self._roster()
        secret = self.board.ensure_channel("lineage-muse", kind="lineage", created_by="muse")
        self.board.join(secret, "muse")
        self.board.join(secret, "muse-1")
        self.board.post(from_agent="muse", body="family only", channel=secret)
        # glm-1 is a different lineage: no join, no DM, no mention.
        isolated = self.board.poll("glm-1")
        self.assertFalse(any(m["body"] == "family only" for m in isolated))
        # Mention punches through isolation.
        self.board.post(
            from_agent="muse", body="hey glm-1", channel=secret, mentions=["glm-1"]
        )
        punched = self.board.poll("glm-1")
        self.assertTrue(any(m["body"] == "hey glm-1" for m in punched))
        # And a DM punches through too.
        self.board.dm("muse-1", "glm-1", "side channel")
        punched2 = self.board.poll("glm-1")
        self.assertTrue(any(m["body"] == "side channel" for m in punched2))

    def test_poll_since_id_and_limit(self):
        self._roster()
        a = self.board.post(from_agent="arch", body="a", channel="hive")
        self.board.post(from_agent="arch", body="b", channel="hive")
        self.board.post(from_agent="arch", body="c", channel="hive")
        rest = self.board.poll("arch", since_id=a["id"])
        self.assertEqual([m["body"] for m in rest], ["b", "c"])
        limited = self.board.poll("arch", limit=1)
        self.assertEqual([m["body"] for m in limited], ["a"])

    def test_ack(self):
        self._roster()
        msg = self.board.post(from_agent="arch", body="do this", channel="hive")
        rec = self.board.ack("muse-1", msg["id"])
        self.assertEqual(rec["agent_id"], "muse-1")
        self.assertEqual(rec["message_id"], msg["id"])
        self.assertTrue(rec["acked_at"])
        # Idempotent re-ack.
        rec2 = self.board.ack("muse-1", msg["id"])
        self.assertEqual(rec2["message_id"], msg["id"])
        with self.assertRaises(BoardError):
            self.board.ack("muse-1", 9999)

    def test_format_feed(self):
        self._roster()
        msg = self.board.post(from_agent="arch", body="hello", channel="hive",
                              mentions=["muse"])
        text = self.board.format_feed([msg])
        self.assertIn("hello", text)
        self.assertIn("arch", text)
        self.assertIn("#hive", text)
        self.assertIn("@muse", text)

    def test_post_unknown_agent_or_channel_fails_closed(self):
        self._roster()
        with self.assertRaises(BoardError):
            self.board.post(from_agent="ghost", body="x", channel="hive")
        with self.assertRaises(BoardError):
            self.board.post(from_agent="arch", body="x", channel="no-such-room")
        with self.assertRaises(BoardError):
            self.board.post(from_agent="arch", body="", channel="hive")
        with self.assertRaises(BoardError):
            self.board.dm("muse-1", "muse-1", "selfie")

    def test_empty_body_and_bad_kind_fail_closed(self):
        self._roster()
        with self.assertRaises(BoardError):
            self.board.post(from_agent="arch", body="ok", channel="hive", kind="whisper")


class TestCli(BoardTestCase):
    def _run(self, *argv):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = board_main(["--db", self.db, *argv])
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
            "--provider", "fable", "--model", "5.1",
        )
        self.assertEqual(rc, 0)
        self.assertEqual(arch["id"], "arch")

        rc, muse = self._run(
            "register", "--id", "muse", "--role", "captain",
            "--provider", "andrewcode", "--model", "muse-spark-1.3",
            "--parent-id", "arch", "--lineage", "arch/muse", "--depth", "1",
        )
        self.assertEqual(rc, 0)
        self.assertEqual(muse["parent_id"], "arch")

        rc, child_a = self._run(
            "register", "--id", "muse-1", "--role", "child",
            "--provider", "andrewcode", "--model", "muse-spark-1.3",
            "--parent-id", "muse", "--lineage", "arch/muse/muse-1", "--depth", "2",
        )
        self.assertEqual(rc, 0)
        rc, glm = self._run(
            "register", "--id", "glm", "--role", "captain",
            "--provider", "opencode", "--model", "glm-5.3",
            "--parent-id", "arch", "--lineage", "arch/glm", "--depth", "1",
        )
        self.assertEqual(rc, 0)
        rc, child_b = self._run(
            "register", "--id", "glm-1", "--role", "child",
            "--provider", "andrewcode", "--model", "muse-spark-1.3",
            "--parent-id", "glm", "--lineage", "arch/glm/glm-1", "--depth", "2",
        )
        self.assertEqual(rc, 0)

        rc, posted = self._run("post", "--from", "arch", "--body", "go", "--channel", "hive")
        self.assertEqual(rc, 0)
        self.assertEqual(posted["body"], "go")

        rc, dm = self._run("dm", "--from", "muse-1", "--to", "glm-1", "--body", "hi")
        self.assertEqual(rc, 0)
        self.assertEqual(dm["channel"], "dm:glm-1:muse-1")

        rc, reply = self._run(
            "reply", "--from", "muse", "--message-id", str(posted["id"]), "--body", "on it"
        )
        self.assertEqual(rc, 0)
        self.assertEqual(reply["thread_id"], posted["id"])

        rc, poll = self._run("poll", "--agent", "glm-1")
        self.assertEqual(rc, 0)
        bodies = [m["body"] for m in poll]
        self.assertIn("go", bodies)
        self.assertIn("hi", bodies)

        rc, ments = self._run(
            "post", "--from", "arch", "--body", "ping glm-1",
            "--channel", "architect", "--mentions", "glm-1",
        )
        self.assertEqual(rc, 0)
        rc, hits = self._run("mentions", "--agent", "glm-1")
        self.assertEqual(rc, 0)
        self.assertTrue(any(m["body"] == "ping glm-1" for m in hits))

        rc, tree = self._run("tree")
        self.assertEqual(rc, 0)
        self.assertEqual(tree["roots"][0]["id"], "arch")

        rc, agents = self._run("agents")
        self.assertEqual(rc, 0)
        self.assertEqual(len(agents), 5)

        rc, hb = self._run("heartbeat", "--agent", "arch", "--status", "idle")
        self.assertEqual(rc, 0)
        self.assertEqual(hb["status"], "idle")

        rc, joined = self._run("join", "--channel", "system", "--agent", "muse-1")
        self.assertEqual(rc, 0)
        self.assertEqual(joined["channel"], "system")

        rc, acked = self._run("ack", "--agent", "muse-1", "--message-id", str(posted["id"]))
        self.assertEqual(rc, 0)
        self.assertEqual(acked["message_id"], posted["id"])

        rc, chans = self._run("channels")
        self.assertEqual(rc, 0)
        self.assertTrue(any(c["name"] == "hive" for c in chans))

    def test_cli_error_is_json(self):
        rc, data = self._run("post", "--from", "ghost", "--body", "x")
        self.assertEqual(rc, 1)
        self.assertFalse(data["ok"])
        self.assertIn("error", data)

    def test_cli_defaults_db_from_fusion_board_env(self):
        prev = os.environ.get("FUSION_BOARD")
        os.environ["FUSION_BOARD"] = self.db
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                rc = board_main(["init"])
            data = json.loads(buf.getvalue())
        finally:
            if prev is None:
                os.environ.pop("FUSION_BOARD", None)
            else:
                os.environ["FUSION_BOARD"] = prev
        self.assertEqual(rc, 0)
        self.assertTrue(data["ok"])
        self.assertEqual(data["db"], self.db)


class TestIndependentConnections(unittest.TestCase):
    def test_two_connections_see_each_others_posts(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = os.path.join(tmp, "hive.sqlite")
            a = HiveBoard(db)
            b = HiveBoard(db)
            try:
                a.register(_agent("arch", role="architect", provider="fable", model="5.1"))
                b.register(_agent("muse", role="captain", parent="arch",
                                  lineage="arch/muse", depth=1))
                a.post(from_agent="arch", body="from-a", channel="hive")
                feed = b.poll("muse")
                self.assertTrue(any(m["body"] == "from-a" for m in feed))
            finally:
                a.close()
                b.close()


if __name__ == "__main__":
    unittest.main()
