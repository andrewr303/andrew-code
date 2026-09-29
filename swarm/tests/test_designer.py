"""Offline unit tests for the Fusion swarm designer (Slice D).

No CLIs, no network. Run from the plugin root:

    python -m unittest tests.test_designer
"""
from __future__ import annotations

import json
import os
import sys
import unittest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm.designer import (  # noqa: E402
    CATALOG_NAMES,
    DEFAULT_MAX_AGENTS,
    DEFAULT_MAX_CHILDREN,
    DEFAULT_MAX_DEPTH,
    NESTED_HIVE_EXAMPLE,
    SPEC_COMMUNICATION,
    TOPOLOGIES,
    TOPOLOGY_COMMUNICATION,
    AgentSeat,
    CaptainSpec,
    DesignerError,
    SwarmSpec,
    Topology,
    catalog,
    design_prompt,
    get_topology,
    parse_swarm_spec,
    validate_spec,
)


REQUIRED_CATALOG = (
    "solo", "panel", "council", "debate", "vote", "swarm",
    "hierarchy", "metaloop", "moa", "heavy", "discuss", "graph",
    "ladder", "speclock", "breaker", "ballot", "factory", "diamond",
    "nested-hive", "ultraswarm", "ureview", "custom",
)

LIVE_ROSTER = [
    "fable", "codex", "andrewcode", "opencode", "grok", "copilot", "kimi",
]


def _nested_hive(**overrides):
    d = json.loads(json.dumps(NESTED_HIVE_EXAMPLE))
    d["task"] = "build the hive"
    d.update(overrides)
    return SwarmSpec.from_dict(d)


class TestCatalog(unittest.TestCase):
    def test_every_catalog_name_unique(self):
        names = [t.name for t in catalog()]
        self.assertEqual(len(names), len(set(names)), names)
        self.assertEqual(tuple(names), CATALOG_NAMES)
        self.assertEqual(set(names), set(TOPOLOGIES))

    def test_required_forms_present(self):
        names = set(CATALOG_NAMES)
        missing = [n for n in REQUIRED_CATALOG if n not in names]
        self.assertEqual(missing, [], f"missing catalog forms: {missing}")

    def test_topology_fields(self):
        for t in catalog():
            self.assertIsInstance(t, Topology)
            self.assertTrue(t.name)
            self.assertTrue(t.when)
            self.assertTrue(t.mechanic)
            self.assertIn(t.communication, TOPOLOGY_COMMUNICATION, t.name)
            self.assertIsInstance(t.nesting, bool)
            self.assertIsInstance(t.default_captains, int)
            self.assertIsInstance(t.default_children, int)
            self.assertTrue(t.cost_shape)
            self.assertEqual(t.to_dict()["name"], t.name)

    def test_nested_hive_is_board_and_nesting(self):
        t = get_topology("nested-hive")
        self.assertIsNotNone(t)
        self.assertEqual(t.communication, "board")
        self.assertTrue(t.nesting)
        self.assertGreaterEqual(t.default_captains, 4)
        self.assertGreaterEqual(t.default_children, 4)

    def test_get_topology_unknown(self):
        self.assertIsNone(get_topology("not-a-form"))


class TestParseSwarmSpec(unittest.TestCase):
    def test_parse_fenced_json(self):
        payload = dict(NESTED_HIVE_EXAMPLE)
        payload["task"] = "ship nested hive"
        fenced = "Here is the design:\n```json\n" + json.dumps(payload, indent=2) + "\n```\nThanks."
        spec = parse_swarm_spec(fenced)
        self.assertEqual(spec.name, "nested-hive")
        self.assertEqual(spec.architect.provider, "fable")
        self.assertEqual(spec.architect.model, "fable-5.1")
        self.assertEqual(len(spec.captains), 4)
        self.assertEqual(spec.captains[0].id, "muse")
        self.assertEqual(spec.captains[0].spawn, 4)
        self.assertEqual(spec.captains[1].id, "glm")
        self.assertEqual(spec.captains[1].spawn, 4)
        self.assertTrue(spec.cross_talk)
        self.assertTrue(spec.board)
        self.assertEqual(spec.communication, "open")
        self.assertEqual(spec.task, "ship nested hive")

    def test_parse_bare_json(self):
        spec = parse_swarm_spec(json.dumps({
            "name": "solo",
            "architect": {"provider": "fable", "model": "fable-5.1"},
        }))
        self.assertEqual(spec.name, "solo")
        self.assertEqual(spec.captains, [])
        self.assertFalse(spec.board)

    def test_parse_json_fence_without_language(self):
        body = json.dumps({
            "name": "panel",
            "architect": {"provider": "fable", "model": "fable-5.1"},
            "captains": [
                {"id": "c1", "provider": "grok", "model": "grok-4.5", "spawn": 0, "spawn_via": "adapter"},
            ],
        })
        spec = parse_swarm_spec(f"```\n{body}\n```")
        self.assertEqual(spec.name, "panel")
        self.assertEqual(spec.captains[0].provider, "grok")

    def test_from_dict_rejects_unknown_field(self):
        with self.assertRaises(DesignerError) as ctx:
            SwarmSpec.from_dict({
                "name": "solo",
                "architect": {"provider": "fable", "model": "x"},
                "bogus": 1,
            })
        self.assertTrue(any("unknown field" in e for e in ctx.exception.errors))

    def test_from_dict_rejects_unknown_captain_field(self):
        with self.assertRaises(DesignerError) as ctx:
            SwarmSpec.from_dict({
                "name": "panel",
                "architect": {"provider": "fable", "model": "x"},
                "captains": [{"id": "c", "provider": "grok", "model": "m", "persona": "pirate"}],
            })
        self.assertTrue(any("unknown field" in e for e in ctx.exception.errors))

    def test_from_dict_rejects_non_object(self):
        with self.assertRaises(DesignerError):
            SwarmSpec.from_dict(["not", "an", "object"])

    def test_parse_empty_fails(self):
        with self.assertRaises(DesignerError):
            parse_swarm_spec("")

    def test_roundtrip_to_dict(self):
        spec = _nested_hive()
        again = SwarmSpec.from_dict(spec.to_dict())
        self.assertEqual(spec.to_dict(), again.to_dict())


class TestValidateSpec(unittest.TestCase):
    def test_nested_hive_happy_path(self):
        spec = _nested_hive()
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertEqual(errs, [], errs)
        # 1 architect + 1 operator + 4 captains + 8 children = 14 <= 24
        self.assertLessEqual(1 + 1 + 4 + 8, spec.max_agents)
        self.assertEqual(spec.max_children_per_agent, DEFAULT_MAX_CHILDREN)
        self.assertEqual(spec.max_depth, DEFAULT_MAX_DEPTH)
        self.assertEqual(spec.max_agents, DEFAULT_MAX_AGENTS)

    def test_nested_hive_happy_path_dict_roster(self):
        roster = {p: {"model": "x"} for p in LIVE_ROSTER}
        self.assertEqual(validate_spec(_nested_hive(), roster), [])

    def test_reject_over_spawn(self):
        spec = _nested_hive()
        spec.captains[0].spawn = spec.max_children_per_agent + 1
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertTrue(any("spawn" in e and "max_children_per_agent" in e for e in errs), errs)

    def test_reject_missing_architect(self):
        spec = SwarmSpec(name="solo")
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertTrue(any("missing architect" in e for e in errs), errs)

    def test_reject_empty_architect_provider(self):
        spec = SwarmSpec(name="solo", architect=AgentSeat(provider="", model="x"))
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertTrue(any("missing architect" in e for e in errs), errs)

    def test_reject_cross_talk_without_board(self):
        spec = SwarmSpec(
            name="custom",
            architect=AgentSeat("fable", "fable-5.1"),
            cross_talk=True,
            board=False,
        )
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertTrue(any("board=false when cross_talk" in e for e in errs), errs)

    def test_unknown_provider_is_error(self):
        spec = SwarmSpec(
            name="solo",
            architect=AgentSeat("wizard", "wand-9"),
        )
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertTrue(any("unknown provider" in e and "wizard" in e for e in errs), errs)
        # not a warning-shaped message
        self.assertFalse(any("warn" in e.lower() for e in errs))

    def test_unknown_captain_provider_is_error(self):
        spec = SwarmSpec(
            name="panel",
            architect=AgentSeat("fable", "fable-5.1"),
            captains=[CaptainSpec(id="x", provider="not-a-cli", model="m")],
            max_depth=1,
        )
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertTrue(any("unknown provider" in e and "not-a-cli" in e for e in errs), errs)

    def test_cross_talk_with_board_ok(self):
        spec = SwarmSpec(
            name="nested-hive",
            architect=AgentSeat("fable", "fable-5.1"),
            board=True,
            cross_talk=True,
            communication="open",
        )
        self.assertEqual(validate_spec(spec, LIVE_ROSTER), [])

    def test_duplicate_captain_ids(self):
        spec = SwarmSpec(
            name="panel",
            architect=AgentSeat("fable", "fable-5.1"),
            captains=[
                CaptainSpec(id="muse", provider="andrewcode", model="m"),
                CaptainSpec(id="muse", provider="opencode", model="g"),
            ],
            max_depth=1,
        )
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertTrue(any("duplicated" in e for e in errs), errs)

    def test_max_agents_exceeded(self):
        spec = _nested_hive(max_agents=5)
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertTrue(any("max_agents" in e for e in errs), errs)

    def test_bad_communication(self):
        spec = SwarmSpec(
            name="solo",
            architect=AgentSeat("fable", "fable-5.1"),
            communication="telepathy",
        )
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertTrue(any("communication" in e for e in errs), errs)
        self.assertTrue(all(c in SPEC_COMMUNICATION for c in ("open", "lineage", "need-to-know")))

    def test_spawn_zero_ok(self):
        spec = SwarmSpec(
            name="panel",
            architect=AgentSeat("fable", "fable-5.1"),
            captains=[CaptainSpec(id="g", provider="grok", model="grok-4.5", spawn=0, spawn_via="adapter")],
            max_depth=1,
        )
        self.assertEqual(validate_spec(spec, LIVE_ROSTER), [])


class TestDesignPrompt(unittest.TestCase):
    def test_includes_task_roster_constraints_and_latitude(self):
        prompt = design_prompt(
            task="Ship a nested coding swarm",
            live_roster=LIVE_ROSTER,
            constraints={"architect.model": "fable-5.1", "captains[0].model": "muse-spark-1.3"},
        )
        self.assertIn("Ship a nested coding swarm", prompt)
        self.assertIn("fable", prompt)
        self.assertIn("muse-spark-1.3", prompt)
        self.assertIn("glm-5.3", prompt)
        self.assertIn("LATITUDE", prompt)
        self.assertIn("invent a custom swarm", prompt.lower().replace("\n", " ") or prompt)
        # user-pinned are hard
        self.assertIn("HARD CONSTRAINTS", prompt)
        self.assertIn("do not change", prompt.lower())
        # nested-hive example
        self.assertIn("nested-hive", prompt)
        self.assertIn('"spawn": 4', prompt)
        self.assertIn("architect talks to everyone", prompt.lower())
        self.assertIn("ONLY SwarmSpec JSON", prompt)
        for name in REQUIRED_CATALOG:
            self.assertIn(f"`{name}`", prompt, name)

    def test_empty_constraints_says_architects_call(self):
        prompt = design_prompt("t", LIVE_ROSTER, {})
        self.assertIn("none pinned", prompt.lower())


if __name__ == "__main__":
    unittest.main()
