"""Offline contract tests for SLICE P — metaloop + swarm hive entrypoints.

No CLIs, no network, no paid calls. Asserts the skill/command docs and the
MetaLoop helpers keep Hive Board + nested andrewcode spawn as the preferred
path when FUSION_BOARD is set, without dropping classic swarm/metaloop.

Run:  python -m unittest tests.test_hive_entrypoints tests.test_metaloop
  (from the plugin root)
"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_ROOT / "python"))

from fusion_swarm import metaloop  # noqa: E402

SKILL_METALOOP = _ROOT / "skills" / "fusion-metaloop" / "SKILL.md"
SKILL_SWARM = _ROOT / "skills" / "fusion-swarm" / "SKILL.md"
CMD_METALOOP = _ROOT / "commands" / "metaloop.md"
CMD_SWARM = _ROOT / "commands" / "swarm.md"

# AgentIdentity field contract (SLICE P must match identities.py exactly).
IDENTITY_FIELDS = (
    "id", "display_name", "role", "provider", "model",
    "parent_id", "lineage", "depth", "spawn_budget", "max_depth", "status",
)
HIVE_ROLES = ("architect", "operator", "captain", "worker", "child")


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class TestEntrypointFilesExist(unittest.TestCase):
    def test_four_files_present(self):
        for p in (SKILL_METALOOP, SKILL_SWARM, CMD_METALOOP, CMD_SWARM):
            self.assertTrue(p.is_file(), f"missing {p}")


class TestMetaLoopSkillHive(unittest.TestCase):
    def setUp(self):
        self.text = _read(SKILL_METALOOP)

    def test_keeps_org_chart_roles(self):
        for needle in (
            "Main Strategic Planner",
            "Chief Operator",
            "Executor Host",
            "Worker Swarm",
            "Fable",
        ):
            self.assertIn(needle, self.text)

    def test_communication_is_hive_board(self):
        self.assertIn("Communication = Hive Board", self.text)
        self.assertIn("FUSION_BOARD", self.text)
        self.assertIn("python -m fusion_swarm.board", self.text)
        self.assertIn('poll --agent "$FUSION_AGENT_ID"', self.text)

    def test_nested_andrewcode_children(self):
        low = self.text.lower()
        self.assertIn("nested", low)
        self.assertIn("andrewcode", low)
        self.assertIn("spawn_nested_andrewcode", self.text)
        self.assertIn("--auto --yolo --output-format text", self.text)
        self.assertIn("children are always andrewcode", low)

    def test_workers_never_talk_to_human(self):
        self.assertIn("NEVER talk to the human", self.text)

    def test_board_not_human_facing_except_architect(self):
        self.assertIn("Not human-facing", self.text)
        self.assertIn("architect/host", self.text.lower())

    def test_default_channels_named(self):
        for ch in ("hive", "architect", "captains", "workers", "system",
                   "lineage-<captain>", "task-main"):
            self.assertIn(ch, self.text)

    def test_honesty_rules(self):
        self.assertIn("absent", self.text.lower())
        self.assertIn("Real dispatch only", self.text)


class TestMetaLoopCommandHive(unittest.TestCase):
    def setUp(self):
        self.text = _read(CMD_METALOOP)

    def test_invokes_metaloop_skill(self):
        self.assertIn("**fusion-metaloop** skill", self.text)

    def test_board_and_nested_spawn(self):
        self.assertIn("FUSION_BOARD", self.text)
        self.assertIn("Hive Board", self.text)
        self.assertIn("nested andrewcode", self.text.lower())
        self.assertIn("Workers never talk to the human", self.text)

    def test_org_chart_still_named(self):
        self.assertIn("Fable", self.text)
        self.assertIn("Chief Operator", self.text)
        self.assertIn("agy", self.text)


class TestSwarmSkillHive(unittest.TestCase):
    def setUp(self):
        self.text = _read(SKILL_SWARM)

    def test_recommends_nested_hive_for_large_work(self):
        self.assertIn("nested-hive", self.text)
        self.assertIn("hive", self.text.lower())
        self.assertIn("large multi-file", self.text.lower())
        self.assertIn("recommend", self.text.lower())

    def test_classic_swarm_still_allowed(self):
        self.assertIn("classic", self.text.lower())
        self.assertIn("mode = swarm", self.text)
        self.assertIn("fusion.sh dispatch", self.text)

    def test_hive_mechanic_matches_shared_contract(self):
        for needle in (
            "python -m fusion_swarm.hive",
            "python -m fusion_swarm.board --db \"$FUSION_BOARD\"",
            "spawn_via=andrewcode",
            "pattern=hive",
            "dry_run",
            "lineage-<captain>",
            "task-main",
            "--auto --yolo --output-format text",
        ):
            self.assertIn(needle, self.text)

    def test_honesty(self):
        self.assertIn("absent ≠ agreement", self.text)
        self.assertIn("real dispatch only", self.text.lower())
        self.assertIn("never talk to the human", self.text.lower())


class TestSwarmCommandHive(unittest.TestCase):
    def setUp(self):
        self.text = _read(CMD_SWARM)

    def test_invokes_swarm_skill(self):
        self.assertIn("**fusion-swarm** skill", self.text)

    def test_shape_first_nested_hive(self):
        self.assertIn("nested-hive", self.text)
        self.assertIn("Hive Board", self.text)
        self.assertIn("mode = swarm", self.text)
        self.assertIn("python -m fusion_swarm.hive", self.text)
        self.assertIn("absent ≠ agreement", self.text)


class TestHiveHelpersOffline(unittest.TestCase):
    """Engine-side helpers the skills tell the host to call. Injected, no CLI."""

    def test_register_payload_roles_and_fields(self):
        for role in HIVE_ROLES:
            p = metaloop.hive_register_payload(
                agent_id=f"a-{role}", display_name=role, role=role,
                provider="andrewcode", model="m")
            self.assertEqual(set(p), set(IDENTITY_FIELDS))
            self.assertEqual(p["role"], role)

    def test_register_on_injected_board(self):
        class Board:
            def __init__(self):
                self.got = None

            def register(self, ident):
                self.got = ident
                return ident

        b = Board()
        ident = metaloop.hive_register_payload(
            agent_id="w1", display_name="w1", role="worker",
            provider="andrewcode", model="m")
        out = metaloop.register_on_hive_board(
            ident, board=b, environ={"FUSION_BOARD": "hive.sqlite"})
        self.assertEqual(out["id"], "w1")
        self.assertEqual(b.got["provider"], "andrewcode")

    def test_prompt_includes_board_howto_when_env_set(self):
        from fusion_swarm.contracts import TaskSpec
        task = TaskSpec(
            id="T-1", objective="do a thing", category="test_implementation",
            acceptance_criteria=["works"], preferred_tier="fast",
            approval_level="none",
        )
        p = metaloop.build_worker_prompt(
            task, "capsule", tier="expert",
            environ={"FUSION_BOARD": "hive.sqlite"},
        )
        self.assertIn("HIVE BOARD", p)
        self.assertIn("python -m fusion_swarm.board", p)
        self.assertIn("Never talk to the human", p)

    def test_prompt_omits_board_when_unset(self):
        from fusion_swarm.contracts import TaskSpec
        p = metaloop.build_worker_prompt(
            TaskSpec(id="T-1", objective="do a thing", category="test_implementation",
                     acceptance_criteria=["works"], preferred_tier="fast",
                     approval_level="none"),
            "capsule",
            tier="fast",
            environ={},
        )
        self.assertNotIn("HIVE BOARD", p)


if __name__ == "__main__":
    unittest.main()
