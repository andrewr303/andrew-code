"""Offline contract tests for skills/fusion-hive/SKILL.md.

No CLIs, no network, no paid calls. The skill file IS the program for
this slice: load-bearing instructions must actually be in the markdown.

Run:  python -m unittest tests.test_hive_skill      (from the plugin root)
  or: python tests/test_hive_skill.py
"""
from __future__ import annotations

import os
import re
import unittest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SKILL = os.path.join(_ROOT, "skills", "fusion-hive", "SKILL.md")


def _read_skill() -> str:
    with open(_SKILL, encoding="utf-8") as fh:
        return fh.read()


class TestHiveSkillExists(unittest.TestCase):
    def test_skill_file_exists(self):
        self.assertTrue(os.path.isfile(_SKILL), _SKILL)

    def test_skill_is_the_only_slice_file_under_skills_fusion_hive(self):
        skill_dir = os.path.dirname(_SKILL)
        names = sorted(os.listdir(skill_dir))
        self.assertEqual(names, ["SKILL.md"])


class TestHiveFrontmatter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read_skill()
        m = re.match(r"^---\s*\n(?P<body>.*?)\n---\s*\n", cls.text, re.DOTALL)
        cls.assertIsNotNone(cls, m, "YAML frontmatter missing")
        cls.fm = m.group("body")

    def test_name_is_fusion_hive(self):
        self.assertRegex(self.fm, r"(?m)^name:\s*fusion-hive\s*$")

    def test_description_covers_nested_andrewcode_and_hive_board(self):
        desc = self.fm.lower()
        self.assertIn("nested", desc)
        self.assertIn("andrewcode", desc)
        self.assertIn("hive board", desc)
        self.assertIn("fable", desc)
        self.assertIn("astra", desc)

    def test_description_covers_designer_latitude(self):
        desc = self.fm.lower()
        self.assertTrue(
            "latitude" in desc or "design" in desc,
            "description must mention designer latitude / DESIGN",
        )


class TestHiveImmediateAction(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read_skill()

    def test_immediate_action_no_discovery(self):
        self.assertRegex(self.text, r"IMMEDIATE ACTION")
        self.assertRegex(self.text, r"NO DISCOVERY|Forbidden")

    def test_resolves_fusion_plugin_root_from_this_skill_md(self):
        self.assertRegex(
            self.text,
            r"FUSION_PLUGIN_ROOT.*THIS `SKILL\.md`|from THIS `SKILL\.md`",
        )
        self.assertIn("skills/fusion-hive/SKILL.md", self.text)
        self.assertRegex(
            self.text,
            r"two directories above|parent of `skills/`",
        )

    def test_forbids_home_discovery(self):
        for needle in (
            "find ~",
            "find ~/.codex",
            "find ~/.claude",
            "find ~/.andrewcode",
        ):
            self.assertIn(needle, self.text)

    def test_first_command_is_dry_run_then_without(self):
        # dry-run first
        self.assertRegex(
            self.text,
            r'swarm\.sh" hive "<goal>" --dry-run',
        )
        # then execute without dry-run
        self.assertRegex(
            self.text,
            r"without.*--dry-run|without `--dry-run`",
        )
        self.assertRegex(
            self.text,
            r'swarm\.sh" hive "<goal>"(?! --dry-run)',
        )


class TestHiveOrgAndExample(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read_skill()

    def test_architect_talks_to_human_everyone_else_on_board(self):
        self.assertRegex(
            self.text,
            r"architect talks to the human",
            re.I,
        )
        self.assertRegex(
            self.text,
            r"Everyone else talks on \*\*one Hive Board\*\*|everyone else is on the board",
            re.I,
        )
        self.assertRegex(self.text, r"NEVER talk to the human")

    def test_example_four_captains_muse_glm_four_children(self):
        self.assertRegex(self.text, r"4 captains", re.I)
        self.assertIn("muse-spark-1.3", self.text)
        self.assertIn("glm-5.3", self.text)
        self.assertRegex(self.text, r"4 children", re.I)
        self.assertRegex(self.text, r"cross-lineage", re.I)

    def test_cross_lineage_talk(self):
        self.assertRegex(
            self.text,
            r"Children of different captains can talk|cross-lineage talk",
            re.I,
        )
        self.assertIn("@mention", self.text)

    def test_spawn_via_andrewcode_at_user_path(self):
        self.assertIn("C:/Users/Andrew/.andrewcode", self.text)
        self.assertIn("C:/Users/Andrew/.andrewcode/bin/andrewcode", self.text)
        self.assertRegex(
            self.text,
            r"andrewcode -p .* -m .* --auto --yolo --output-format text",
        )
        self.assertIn("spawn_andrewcode", self.text)

    def test_children_are_andrewcode_even_when_captain_is_opencode(self):
        self.assertRegex(
            self.text,
            r"even though the captain is opencode|children are still AndrewCode",
            re.I,
        )


class TestHiveHardRules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read_skill()

    def test_real_dispatch_only(self):
        self.assertRegex(self.text, r"Real dispatch only")
        self.assertRegex(
            self.text,
            r"PROHIBITED from imagining, simulating",
        )

    def test_do_not_tell_host_to_simulate_workers(self):
        collapsed = re.sub(r"\s+", " ", self.text)
        self.assertRegex(
            collapsed,
            r"Do not tell the host to (simulate workers|pretend to be a worker)",
        )
        self.assertNotRegex(
            collapsed,
            r"simulate the workers yourself|pretend you are each child",
        )

    def test_absent_not_agreement(self):
        self.assertRegex(self.text, r"Absent ≠ agreement|Absent != agreement")

    def test_gates_outrank_models(self):
        self.assertRegex(
            self.text,
            r"Gates outrank models|gates outrank models",
        )
        self.assertRegex(
            self.text,
            r"failing test.*beats|Deterministic verification is the arbiter",
            re.I,
        )

    def test_board_cli_exact_invocation(self):
        self.assertIn(
            'python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"',
            self.text,
        )
        for verb in ("post", "dm", "reply", "mentions", "ack", "heartbeat", "join"):
            self.assertIn(
                f'python -m fusion_swarm.board --db "$FUSION_BOARD" {verb}',
                self.text,
            )

    def test_default_channels_named(self):
        for ch in ("hive", "architect", "captains", "workers", "system"):
            self.assertIn(f"`{ch}`", self.text)
        self.assertIn("lineage-<captain>", self.text)
        self.assertIn("task-main", self.text)

    def test_spawn_limits_named(self):
        self.assertIn("max_depth=2", self.text)
        self.assertIn("max_children_per_agent=4", self.text)
        self.assertIn("max_agents=24", self.text)

    def test_catalog_forms_and_custom_latitude(self):
        for form in (
            "solo", "panel", "council", "debate", "vote", "swarm",
            "hierarchy", "metaloop", "moa", "heavy", "discuss", "graph",
            "ladder", "speclock", "breaker", "ballot", "factory", "diamond",
            "nested-hive", "ultraswarm", "ureview", "custom",
        ):
            self.assertIn(form, self.text)
        self.assertRegex(self.text, r"designer latitude|invent a custom topology")


class TestHiveDoesNotInventLiveCalls(unittest.TestCase):
    def test_mentions_dry_run_does_not_subprocess(self):
        text = _read_skill()
        self.assertRegex(
            text,
            r"does \*\*not\*\* subprocess|does not subprocess",
            re.I,
        )
        self.assertIn("design packet", text.lower())


if __name__ == "__main__":
    unittest.main()
