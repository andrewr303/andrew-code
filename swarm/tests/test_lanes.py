"""Offline unit tests for fusion_swarm.lanes wrapping HiveBoard.

No CLIs, no network, no codefusion. Every send() must land on the board.

Run:  python -m unittest tests.test_lanes      (from the plugin root)
  or: python tests/test_lanes.py
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm.board import HiveBoard  # noqa: E402
from fusion_swarm.lanes import (  # noqa: E402
    CommunicationLanes,
    Message,
    _default_state_root,
)


class TestLanesNoCodefusion(unittest.TestCase):
    def test_module_does_not_import_codefusion(self):
        import fusion_swarm.lanes as lanes_mod

        src = Path(lanes_mod.__file__).read_text(encoding="utf-8")
        self.assertNotIn("from codefusion", src)
        self.assertNotIn("import codefusion", src)
        self.assertNotIn("project_state_dir", src)


class TestDefaultStateRoot(unittest.TestCase):
    def test_default_is_home_fusion_hive_session(self):
        expected = Path.home() / ".fusion" / "hive" / "sess-1"
        self.assertEqual(_default_state_root("sess-1"), expected)


class LanesTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state = Path(self.tmp.name)
        self.lanes = CommunicationLanes("sess-test", state_root=self.state)

    def tearDown(self):
        self.lanes.close()
        self.tmp.cleanup()


class TestSendPostsToBoard(LanesTestCase):
    def test_send_posts_hive_and_dm(self):
        msg = self.lanes.send(
            "captain-a",
            "worker-1",
            "take the left flank",
            subject="task",
            msg_type="task",
        )
        self.assertIsInstance(msg, Message)
        self.assertEqual(msg.from_agent, "captain-a")
        self.assertEqual(msg.to_agent, "worker-1")
        self.assertTrue(msg.id.startswith("msg_"))
        self.assertIn("board_id", msg.metadata)
        self.assertEqual(msg.metadata.get("board_channel"), "hive")
        self.assertIn("board_dm_id", msg.metadata)
        self.assertTrue(str(msg.metadata.get("board_dm_channel", "")).startswith("dm:"))

        hive_posts = [
            r
            for r in self.lanes.poll("worker-1")
            if r.get("channel") == "hive" and "take the left flank" in r.get("body", "")
        ]
        self.assertTrue(hive_posts, "send() must post onto channel hive")
        self.assertEqual(hive_posts[0]["from_agent"], "captain-a")
        self.assertEqual(hive_posts[0]["to_agent"], "worker-1")

        dm_posts = [
            r
            for r in self.lanes.poll("worker-1")
            if str(r.get("channel", "")).startswith("dm:")
            and "take the left flank" in r.get("body", "")
        ]
        self.assertTrue(dm_posts, "send() to a specific agent must also DM")

        # Independent HiveBoard handle on the same sqlite file sees the same rows.
        with HiveBoard(self.lanes.board_path) as other:
            polled = other.poll("worker-1")
        self.assertTrue(any("take the left flank" in r.get("body", "") for r in polled))

    def test_broadcast_posts_hive_without_dm(self):
        msg = self.lanes.send("architect", "hive", "stand up", msg_type="status")
        self.assertNotIn("board_dm_id", msg.metadata)
        recs = self.lanes.poll("architect")
        self.assertTrue(any(r.get("channel") == "hive" and r.get("body") == "stand up" for r in recs))
        self.assertFalse(any(str(r.get("channel", "")).startswith("dm:") for r in recs))

    def test_jsonl_mailbox_still_written(self):
        self.lanes.send("a", "b", "hello mailbox")
        inbox = self.state / "inbox" / "b.jsonl"
        self.assertTrue(inbox.is_file())
        text = inbox.read_text(encoding="utf-8")
        self.assertIn("hello mailbox", text)

    def test_board_jsonl_sidecar_exists(self):
        self.lanes.send("a", "b", "sidecar check")
        jsonl = Path(str(self.lanes.board_path) + ".jsonl")
        self.assertTrue(jsonl.is_file())
        self.assertIn("sidecar check", jsonl.read_text(encoding="utf-8"))


class TestCheckInboxAndAck(LanesTestCase):
    def test_check_inbox_pending_then_delivered(self):
        self.lanes.send("captain", "worker", "do the thing")
        pending = self.lanes.check_inbox("worker", mark_delivered=False)
        self.assertTrue(any(m.body == "do the thing" and m.status == "pending" for m in pending))
        delivered = self.lanes.check_inbox("worker", mark_delivered=True)
        self.assertTrue(any(m.body == "do the thing" and m.status == "delivered" for m in delivered))
        again = self.lanes.check_inbox("worker", mark_delivered=True)
        self.assertFalse(any(m.body == "do the thing" and m.status == "pending" for m in again))

    def test_ack_message_hits_board(self):
        msg = self.lanes.send("captain", "worker", "ack me")
        self.assertTrue(self.lanes.ack_message("worker", msg.id))
        board_id = msg.metadata["board_id"]
        with HiveBoard(self.lanes.board_path) as other:
            rows = other._conn.execute(
                "SELECT * FROM acks WHERE agent_id=? AND message_id=?",
                ("worker", board_id),
            ).fetchall()
        self.assertTrue(rows)

    def test_check_inbox_sees_independent_board_post(self):
        self.lanes._ensure_agent("worker")
        self.lanes._ensure_agent("outsider")
        with HiveBoard(self.lanes.board_path) as other:
            other.post(
                from_agent="outsider",
                body="cross-process ping",
                channel="hive",
                to_agent="worker",
                mentions=["worker"],
            )
        found = self.lanes.check_inbox("worker")
        self.assertTrue(any("cross-process ping" in m.body for m in found))


class TestWorkcardsAndTimeline(LanesTestCase):
    def test_claim_and_release_json_files(self):
        ok, card_id = self.lanes.claim_paths("w1", "T-1", ["src/a.py", "src/b.py"], "edit")
        self.assertTrue(ok)
        self.assertTrue(card_id)
        card_file = self.state / "workcards" / f"{card_id}.json"
        self.assertTrue(card_file.is_file())
        blocked, reason = self.lanes.claim_paths("w2", "T-2", ["src/a.py"])
        self.assertFalse(blocked)
        self.assertIn("Path collision", reason or "")
        self.assertTrue(self.lanes.release_workcard(card_id, outcome="merged"))
        ok2, card2 = self.lanes.claim_paths("w2", "T-2", ["src/a.py"])
        self.assertTrue(ok2)
        self.assertTrue(card2)

    def test_timeline_records_mail(self):
        self.lanes.send("a", "b", "logged")
        events = self.lanes.get_timeline()
        self.assertTrue(any(e.get("type") == "mail" for e in events))
        lines = self.lanes.format_timeline()
        self.assertTrue(lines)
        self.assertTrue(any("mail" in ln for ln in lines))


class TestSignatures(LanesTestCase):
    def test_public_methods_exist(self):
        for name in (
            "emit_event",
            "send",
            "check_inbox",
            "ack_message",
            "claim_paths",
            "release_workcard",
            "get_timeline",
            "format_timeline",
        ):
            self.assertTrue(callable(getattr(self.lanes, name)))


if __name__ == "__main__":
    unittest.main()
