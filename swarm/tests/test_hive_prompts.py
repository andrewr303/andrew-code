"""Offline unit tests for Fusion hive prompt templates (SLICE F).

No CLIs, no network. These assert prompt content: env vars, catalog,
SwarmSpec output contract, spawn/cross-talk language, and the exact board CLI.

Run:  python -m unittest tests.test_hive_prompts      (from the plugin root)
  or: python tests/test_hive_prompts.py
"""
from __future__ import annotations

import os
import sys
import unittest
from dataclasses import dataclass

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm import hive_prompts as HP  # noqa: E402


@dataclass
class FakeIdentity:
    id: str
    display_name: str = ""
    role: str = "worker"
    provider: str = "andrewcode"
    model: str = "muse-spark-1.3"
    parent_id: str = None
    lineage: str = ""
    depth: int = 1
    spawn_budget: int = 4
    max_depth: int = 2
    status: str = "online"


REQUIRED_CATALOG = (
    "solo", "panel", "council", "debate", "vote", "swarm", "hierarchy",
    "metaloop", "moa", "heavy", "discuss", "graph", "ladder", "speclock",
    "breaker", "ballot", "factory", "diamond", "nested-hive", "ultraswarm",
    "ureview", "custom",
)

BOARD_SNIPPETS = (
    'python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"',
    'python -m fusion_swarm.board --db "$FUSION_BOARD" mentions --agent "$FUSION_AGENT_ID"',
    'python -m fusion_swarm.board --db "$FUSION_BOARD" post --from "$FUSION_AGENT_ID"',
    'python -m fusion_swarm.board --db "$FUSION_BOARD" dm --from "$FUSION_AGENT_ID"',
    'python -m fusion_swarm.board --db "$FUSION_BOARD" reply --from "$FUSION_AGENT_ID"',
    'python -m fusion_swarm.board --db "$FUSION_BOARD" ack --agent "$FUSION_AGENT_ID"',
    'python -m fusion_swarm.board --db "$FUSION_BOARD" heartbeat --agent "$FUSION_AGENT_ID"',
    'python -m fusion_swarm.board --db "$FUSION_BOARD" join --channel',
)

SWARMSPEC_FIELDS = (
    "name", "architect", "operator", "captains", "cross_talk", "board",
    "max_depth", "max_children_per_agent", "max_agents", "budget",
    "communication", "task", "notes",
)


def _captain(**kw):
    base = dict(
        id="muse", display_name="muse-spark", role="captain",
        provider="andrewcode", model="muse-spark-1.3", parent_id="arch",
        lineage="arch/muse", depth=1, spawn_budget=4,
    )
    base.update(kw)
    return FakeIdentity(**base)


def _worker(**kw):
    base = dict(
        id="muse-2", display_name="muse child 2", role="worker",
        provider="andrewcode", model="muse-spark-1.3", parent_id="muse",
        lineage="arch/muse/muse-2", depth=2, spawn_budget=0,
    )
    base.update(kw)
    return FakeIdentity(**base)


class TestCatalog(unittest.TestCase):
    def test_named_forms_present(self):
        names = set(HP.CATALOG_NAMES)
        missing = [n for n in REQUIRED_CATALOG if n not in names]
        self.assertEqual(missing, [])

    def test_topology_fields(self):
        required = {
            "name", "when", "mechanic", "communication", "nesting",
            "default_captains", "default_children", "cost_shape",
        }
        for item in HP.CATALOG:
            self.assertTrue(required.issubset(item), item["name"])

    def test_summary_lists_every_form(self):
        summary = HP.catalog_summary()
        for name in REQUIRED_CATALOG:
            self.assertIn(name, summary)


class TestBoardHowto(unittest.TestCase):
    def test_env_vars_and_cli(self):
        text = HP.board_howto()
        self.assertIn("$FUSION_BOARD", text)
        self.assertIn("$FUSION_AGENT_ID", text)
        for snippet in BOARD_SNIPPETS:
            self.assertIn(snippet, text, snippet)

    def test_canonical_poll_constant(self):
        self.assertEqual(HP.BOARD_POLL_CMD, BOARD_SNIPPETS[0])
        self.assertIn(HP.BOARD_POLL_CMD, HP.board_howto())


class TestArchitectPrompt(unittest.TestCase):
    def setUp(self):
        self.prompt = HP.architect_prompt(
            task="build the nested hive",
            roster=[
                {"provider": "codex", "model": "gpt-6-astra"},
                {"provider": "opencode", "model": "glm-5.3"},
            ],
            constraints={
                "models": ["muse-spark-1.3", "glm-5.3"],
                "max_agents": 24,
            },
        )

    def test_contains_task_and_roster(self):
        self.assertIn("build the nested hive", self.prompt)
        self.assertIn("gpt-6-astra", self.prompt)
        self.assertIn("glm-5.3", self.prompt)
        self.assertIn("muse-spark-1.3", self.prompt)

    def test_catalog_summary_embedded(self):
        for name in REQUIRED_CATALOG:
            self.assertIn(name, self.prompt, name)

    def test_latitude_to_invent_custom(self):
        low = self.prompt.lower()
        self.assertIn("latitude", low)
        self.assertIn("custom", low)
        self.assertTrue("invent" in low or "no catalog form fits" in low)

    def test_output_contract_swarmspec_json_only(self):
        low = self.prompt.lower()
        self.assertIn("swarmspec", low)
        self.assertIn("json", low)
        self.assertTrue("only" in low and "swarmspec" in low)
        for field in SWARMSPEC_FIELDS:
            self.assertIn(field, self.prompt, field)

    def test_hard_constraints_user_models(self):
        low = self.prompt.lower()
        self.assertIn("hard constraint", low)
        self.assertIn("live roster", low)
        self.assertIn("absent", low)

    def test_env_mentioned_for_spawned_workers(self):
        self.assertIn("$FUSION_BOARD", self.prompt)
        self.assertIn("$FUSION_AGENT_ID", self.prompt)

    def test_accepts_string_roster_and_constraints(self):
        text = HP.architect_prompt("t", "codex, grok", "use grok")
        self.assertIn("t", text)
        self.assertIn("codex, grok", text)
        self.assertIn("use grok", text)


class TestCaptainPrompt(unittest.TestCase):
    def test_env_vars_in_prompt(self):
        text = HP.captain_prompt(_captain(), "ship it", "", ["muse-1", "muse-2"])
        self.assertIn("$FUSION_BOARD", text)
        self.assertIn("$FUSION_AGENT_ID", text)
        self.assertIn(BOARD_SNIPPETS[0], text)

    def test_identity_and_task(self):
        text = HP.captain_prompt(_captain(), "ship it", "", [])
        self.assertIn("muse", text)
        self.assertIn("ship it", text)
        self.assertIn("captain", text.lower())

    def test_never_address_human(self):
        text = HP.captain_prompt(_captain(), "t", "", [])
        low = text.lower()
        self.assertIn("never", low)
        self.assertIn("human", low)

    def test_children_already_spawned_when_listed(self):
        text = HP.captain_prompt(
            _captain(), "t", "", ["muse-1", "muse-2", "muse-3", "muse-4"],
        )
        self.assertIn("muse-1", text)
        self.assertIn("muse-4", text)
        self.assertIn("already spawned", text.lower())

    def test_may_spawn_when_none_listed(self):
        text = HP.captain_prompt(_captain(spawn_budget=4), "t", "", [])
        low = text.lower()
        self.assertIn("spawn", low)
        self.assertIn("4", text)
        self.assertIn("andrewcode", low)
        self.assertTrue("ask" in low or "host" in low or "board" in low)

    def test_cross_talk_true_invites_other_captains_children(self):
        text = HP.captain_prompt(
            _captain(), "t", "", ["muse-1"], cross_talk=True,
        )
        self.assertIn(HP.CROSS_LINEAGE_INVITATION, text)
        self.assertIn("$FUSION_BOARD", text)

    def test_cross_talk_false_omits_cross_lineage_invitation(self):
        text = HP.captain_prompt(
            _captain(), "t", "", ["muse-1"], cross_talk=False,
        )
        self.assertNotIn(HP.CROSS_LINEAGE_INVITATION, text)
        self.assertNotIn("cross-lineage invitation", text.lower())
        self.assertIn("$FUSION_BOARD", text)
        self.assertIn("$FUSION_AGENT_ID", text)

    def test_dict_identity_and_dict_children(self):
        ident = {
            "id": "glm", "role": "captain", "provider": "opencode",
            "model": "glm-5.3", "spawn_budget": 3,
        }
        text = HP.captain_prompt(ident, "t", None, [{"id": "glm-1"}])
        self.assertIn("glm", text)
        self.assertIn("glm-1", text)
        self.assertIn("already spawned", text.lower())

    def test_custom_howto_still_has_env_vars(self):
        text = HP.captain_prompt(_captain(), "t", "use the board", [])
        self.assertIn("$FUSION_BOARD", text)
        self.assertIn("$FUSION_AGENT_ID", text)
        self.assertIn(BOARD_SNIPPETS[0], text)


class TestWorkerPrompt(unittest.TestCase):
    def test_nested_andrewcode_and_env(self):
        text = HP.worker_prompt(_worker(), "implement x", "", ["muse-1"], True)
        low = text.lower()
        self.assertIn("andrewcode", low)
        self.assertIn("nested", low)
        self.assertIn("$FUSION_BOARD", text)
        self.assertIn("$FUSION_AGENT_ID", text)
        self.assertIn(BOARD_SNIPPETS[0], text)

    def test_poll_and_post_progress(self):
        text = HP.worker_prompt(_worker(), "t", "", [], False)
        low = text.lower()
        self.assertIn("poll", low)
        self.assertIn("progress", low)

    def test_never_address_the_human(self):
        text = HP.worker_prompt(_worker(), "t", "", [], False)
        low = text.lower()
        self.assertIn("never", low)
        self.assertIn("human", low)
        self.assertTrue(
            "never address the human" in low or "never talk to the human" in low
        )

    def test_architect_can_at_you(self):
        text = HP.worker_prompt(_worker(), "t", "", [], False)
        low = text.lower()
        self.assertIn("architect", low)
        self.assertTrue("@" in text or "mention" in low)

    def test_siblings_listed(self):
        text = HP.worker_prompt(_worker(), "t", "", ["muse-1", "muse-3"], False)
        self.assertIn("muse-1", text)
        self.assertIn("muse-3", text)

    def test_cross_talk_true_includes_invitation(self):
        text = HP.worker_prompt(_worker(), "t", "", ["muse-1"], True)
        self.assertIn(HP.CROSS_LINEAGE_INVITATION, text)
        self.assertIn("$FUSION_BOARD", text)
        self.assertIn("$FUSION_AGENT_ID", text)

    def test_cross_talk_false_omits_invitation(self):
        text = HP.worker_prompt(_worker(), "t", "", ["muse-1"], False)
        self.assertNotIn(HP.CROSS_LINEAGE_INVITATION, text)
        self.assertNotIn("cross-lineage invitation", text.lower())
        self.assertIn("muse-1", text)
        self.assertIn("$FUSION_BOARD", text)
        self.assertIn("$FUSION_AGENT_ID", text)

    def test_board_cli_snippets_present(self):
        text = HP.worker_prompt(_worker(), "t", "", [], True)
        for snippet in BOARD_SNIPPETS[:5]:
            self.assertIn(snippet, text, snippet)

    def test_string_identity(self):
        text = HP.worker_prompt("w-9", "t", "", ["w-8"], True)
        self.assertIn("w-9", text)
        self.assertIn("w-8", text)


class TestHowtoPassthrough(unittest.TestCase):
    def test_caller_howto_with_env_vars_is_kept(self):
        custom = (
            'python -m fusion_swarm.board --db "$FUSION_BOARD" poll '
            '--agent "$FUSION_AGENT_ID"\n# custom note'
        )
        cap = HP.captain_prompt(_captain(), "t", custom, [])
        wrk = HP.worker_prompt(_worker(), "t", custom, [], False)
        self.assertIn("custom note", cap)
        self.assertIn("custom note", wrk)
        self.assertIn("$FUSION_BOARD", cap)
        self.assertIn("$FUSION_AGENT_ID", wrk)


if __name__ == "__main__":
    unittest.main()
