"""Offline contract tests for skills/fusion-board/SKILL.md (slice K).

No CLIs, no network, no paid calls. The skill *is* the program for hive
captains/workers, so these assert the load-bearing CLI, channel map, and
protocol strings actually exist in the markdown.

Run from the plugin root:
    python -m unittest tests.test_fusion_board_skill
"""
from __future__ import annotations

import os
import re
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
SKILL = _ROOT / "skills" / "fusion-board" / "SKILL.md"


def _frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end < 0:
        return {}
    block = text[3:end]
    out: dict[str, str] = {}
    key = None
    buf: list[str] = []
    for line in block.splitlines():
        if line.startswith("  ") and key:
            buf.append(line.strip())
            continue
        if key is not None:
            out[key] = " ".join(buf).strip()
        m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", line)
        if not m:
            key = None
            buf = []
            continue
        key, rest = m.group(1), m.group(2)
        if rest == ">|" or rest == ">":
            buf = []
        elif rest == ">-":
            buf = []
        else:
            buf = [rest]
    if key is not None:
        out[key] = " ".join(buf).strip()
    return out


class FusionBoardSkill(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.lower = cls.text.lower()

    def test_skill_file_exists(self):
        self.assertTrue(SKILL.is_file(), f"missing {SKILL}")

    def test_frontmatter_name_and_description(self):
        fm = _frontmatter(self.text)
        self.assertEqual(fm.get("name"), "fusion-board")
        desc = fm.get("description", "")
        self.assertGreater(len(desc), 40)
        self.assertRegex(desc.lower(), r"hive|board")

    def test_pythonpath_hint(self):
        self.assertIn("PYTHONPATH", self.text)
        self.assertIn("$FUSION_PLUGIN_ROOT/python", self.text)
        self.assertRegex(
            self.text,
            r'PYTHONPATH="\$FUSION_PLUGIN_ROOT/python\$\{PYTHONPATH:\+:\$PYTHONPATH\}"',
        )

    def test_env_vars(self):
        for var in (
            "FUSION_BOARD",
            "FUSION_AGENT_ID",
            "FUSION_PARENT_ID",
            "FUSION_SWARM_ID",
        ):
            self.assertIn(var, self.text, f"missing env {var}")

    def test_module_invocation(self):
        self.assertIn("python -m fusion_swarm.board", self.text)
        self.assertIn('--db "$FUSION_BOARD"', self.text)
        self.assertIn('--agent "$FUSION_AGENT_ID"', self.text)

    def test_canonical_poll_line(self):
        # hive_prompts contract: exact CLI captains/workers copy
        needle = (
            'python -m fusion_swarm.board --db "$FUSION_BOARD" '
            'poll --agent "$FUSION_AGENT_ID"'
        )
        self.assertIn(needle, self.text)

    def test_cli_verbs(self):
        for verb in (
            "init",
            "register",
            "post",
            "dm",
            "reply",
            "poll",
            "mentions",
            "agents",
            "tree",
            "heartbeat",
            "join",
            "channels",
            "ack",
        ):
            self.assertRegex(
                self.text,
                rf"python -m fusion_swarm\.board --db \"\$FUSION_BOARD\" {verb}",
                f"missing worked example for verb {verb}",
            )

    def test_post_poll_dm_reply_mentions_flags(self):
        self.assertIn("--from", self.text)
        self.assertIn("--body", self.text)
        self.assertIn("--channel", self.text)
        self.assertIn("--to", self.text)
        self.assertIn("--message-id", self.text)
        self.assertIn("--since-id", self.text)
        self.assertIn("--mentions", self.text)
        self.assertIn("--limit", self.text)

    def test_channel_map(self):
        for name in ("hive", "architect", "captains", "workers", "system"):
            self.assertIn(f"`{name}`", self.text, f"default channel {name}")
        self.assertIn("lineage-<id>", self.text)
        self.assertIn("task-<id>", self.text)
        self.assertIn("dm:<sorted_a>:<sorted_b>", self.text)
        self.assertIn("task-main", self.text)
        for kind in ("room", "dm", "thread", "lineage", "task"):
            self.assertIn(kind, self.lower)

    def test_status_protocol_start_block_done(self):
        self.assertIn("status=start", self.text)
        self.assertIn("status=block", self.text)
        self.assertIn("status=done", self.text)
        self.assertRegex(self.lower, r"at least")

    def test_mention_protocol(self):
        self.assertIn("@mention", self.lower)
        self.assertIn("--mentions", self.text)

    def test_who_may_talk(self):
        self.assertRegex(self.lower, r"architect.*anyone")
        self.assertIn("cross_talk", self.text)
        self.assertRegex(self.lower, r"across lineages")

    def test_never_talk_to_the_human(self):
        self.assertRegex(self.text, r"NEVER talk to the human")
        self.assertRegex(self.lower, r"do not wait for the human")
        self.assertRegex(self.lower, r"not human-facing")

    def test_absent_not_agreement(self):
        self.assertRegex(self.lower, r"absent.*agreement")

    def test_json_stdout(self):
        self.assertRegex(self.lower, r"always print json|json on stdout")

    def test_jsonl_sidecar(self):
        self.assertIn(".jsonl", self.text)

    def test_wal_sqlite_no_daemon(self):
        self.assertRegex(self.lower, r"\bwal\b")
        self.assertRegex(self.lower, r"sqlite")
        self.assertRegex(self.lower, r"no daemon")

    def test_roles(self):
        for role in ("architect", "operator", "captain", "worker", "child"):
            self.assertIn(role, self.lower)

    def test_git_bash_windows(self):
        self.assertRegex(self.text, r"Git Bash")

    def test_plugin_root_resolution(self):
        self.assertIn("FUSION_PLUGIN_ROOT", self.text)
        self.assertIn("skills/fusion-board/SKILL.md", self.text)
        self.assertRegex(self.lower, r"two directories above")


if __name__ == "__main__":
    unittest.main()
