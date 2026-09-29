"""Offline unit tests for fusion_swarm.identities. No CLIs, no network.

Run:  python -m unittest tests.test_identities      (from the plugin root)
"""
import os
import sys
import unittest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))

from fusion_swarm.identities import (  # noqa: E402
    AgentIdentity,
    IdentityError,
    SpawnLimits,
    child,
    lineage_of,
    new_id,
    ROLES,
)


def _agent(**kw) -> AgentIdentity:
    base = dict(
        id="arch",
        display_name="Architect",
        role="architect",
        provider="codex",
        model="gpt-6-astra",
        spawn_budget=4,
        max_depth=2,
    )
    base.update(kw)
    return AgentIdentity(**base)


class TestNewId(unittest.TestCase):
    def test_unique(self):
        ids = {new_id("muse") for _ in range(32)}
        self.assertEqual(len(ids), 32)

    def test_prefix(self):
        ident = new_id("muse")
        self.assertTrue(ident.startswith("muse-"))
        self.assertNotIn("/", ident)

    def test_strips_slash_in_prefix(self):
        ident = new_id("arch/muse")
        self.assertTrue(ident.startswith("arch-muse-"))
        self.assertNotIn("/", ident)

    def test_empty_prefix_falls_back(self):
        ident = new_id("  ")
        self.assertTrue(ident.startswith("agent-"))


class TestLineage(unittest.TestCase):
    def test_root_parent_uses_id(self):
        parent = _agent(lineage="")
        self.assertEqual(lineage_of(parent, "muse"), "arch/muse")

    def test_nested_appends(self):
        parent = _agent(id="muse", lineage="arch/muse", depth=1, role="captain")
        self.assertEqual(lineage_of(parent, "muse-2"), "arch/muse/muse-2")

    def test_rejects_slash_in_child_id(self):
        with self.assertRaises(IdentityError):
            lineage_of(_agent(), "a/b")

    def test_rejects_empty_child_id(self):
        with self.assertRaises(IdentityError):
            lineage_of(_agent(), "")


class TestAgentIdentity(unittest.TestCase):
    def test_valid_roles(self):
        for role in ROLES:
            ident = _agent(id=role[:4] + "x", role=role)
            self.assertEqual(ident.role, role)

    def test_unknown_role_fails_closed(self):
        with self.assertRaises(IdentityError):
            _agent(role="wizard")

    def test_empty_id_fails_closed(self):
        with self.assertRaises(IdentityError):
            _agent(id="")

    def test_slash_in_id_fails_closed(self):
        with self.assertRaises(IdentityError):
            _agent(id="arch/muse")

    def test_depth_over_max_fails_closed(self):
        with self.assertRaises(IdentityError):
            _agent(depth=3, max_depth=2)

    def test_negative_budget_fails_closed(self):
        with self.assertRaises(IdentityError):
            _agent(spawn_budget=-1)

    def test_to_dict_roundtrip(self):
        ident = _agent()
        clone = AgentIdentity.from_dict(ident.to_dict())
        self.assertEqual(clone.to_dict(), ident.to_dict())

    def test_from_dict_rejects_unknown_field(self):
        with self.assertRaises(IdentityError):
            AgentIdentity.from_dict({
                "id": "a", "display_name": "A", "role": "architect",
                "provider": "codex", "model": "m", "bogus": 1,
            })


class TestChild(unittest.TestCase):
    def test_increments_depth_and_lineage(self):
        parent = _agent(spawn_budget=2)
        kid = child(parent, id="muse", role="captain", spawn_budget=4)
        self.assertEqual(kid.parent_id, "arch")
        self.assertEqual(kid.depth, 1)
        self.assertEqual(kid.lineage, "arch/muse")
        self.assertEqual(kid.spawn_budget, 4)
        self.assertEqual(parent.spawn_budget, 1)

    def test_spawn_budget_defaults_to_zero(self):
        parent = _agent(spawn_budget=1)
        kid = child(parent, id="w1", role="worker")
        self.assertEqual(kid.spawn_budget, 0)

    def test_inherits_provider_model_max_depth(self):
        parent = _agent(provider="opencode", model="glm-5.3", max_depth=2)
        kid = child(parent, id="c1")
        self.assertEqual(kid.provider, "opencode")
        self.assertEqual(kid.model, "glm-5.3")
        self.assertEqual(kid.max_depth, 2)
        self.assertEqual(kid.role, "child")

    def test_decrements_parent_budget_clamped(self):
        parent = _agent(spawn_budget=0)
        child(parent, id="w1")
        self.assertEqual(parent.spawn_budget, 0)

    def test_rejects_at_max_depth(self):
        leaf = _agent(id="leaf", role="child", depth=2, max_depth=2, spawn_budget=1)
        with self.assertRaises(IdentityError):
            child(leaf, id="too-deep")

    def test_rejects_derived_overrides(self):
        parent = _agent()
        with self.assertRaises(IdentityError):
            child(parent, id="x", depth=9)
        with self.assertRaises(IdentityError):
            child(parent, id="x", parent_id="other")
        with self.assertRaises(IdentityError):
            child(parent, id="x", lineage="nope")

    def test_rejects_unknown_kwargs(self):
        with self.assertRaises(IdentityError):
            child(_agent(), id="x", bogus=True)

    def test_two_level_tree_architect_muse_four_unique_children(self):
        architect = _agent(
            id="arch", role="architect", spawn_budget=4, max_depth=2,
        )
        muse = child(
            architect,
            id="muse",
            display_name="Muse",
            role="captain",
            provider="andrewcode",
            model="muse-spark-1.3",
            spawn_budget=4,
        )
        self.assertEqual(muse.depth, 1)
        self.assertEqual(muse.lineage, "arch/muse")
        self.assertEqual(muse.parent_id, "arch")
        self.assertEqual(architect.spawn_budget, 3)

        kids = [
            child(
                muse,
                role="child",
                provider="andrewcode",
                model="muse-spark-1.3",
            )
            for _ in range(4)
        ]
        self.assertEqual(len(kids), 4)
        self.assertEqual(muse.spawn_budget, 0)
        ids = [architect.id, muse.id] + [k.id for k in kids]
        self.assertEqual(len(ids), 6)
        self.assertEqual(len(set(ids)), 6)
        for i, kid in enumerate(kids):
            self.assertEqual(kid.depth, 2)
            self.assertEqual(kid.parent_id, "muse")
            self.assertTrue(kid.lineage.startswith("arch/muse/"))
            self.assertEqual(kid.lineage, f"arch/muse/{kid.id}")
            self.assertEqual(kid.spawn_budget, 0)
            self.assertEqual(kid.role, "child")


class TestSpawnLimits(unittest.TestCase):
    def test_allows_valid_spawn(self):
        limits = SpawnLimits()
        ok, reason = limits.can_spawn(_agent(depth=0), current_total=1, current_children=0)
        self.assertTrue(ok)
        self.assertEqual(reason, "")

    def test_refuses_when_depth_at_max(self):
        limits = SpawnLimits(max_depth=2)
        parent = _agent(id="leaf", role="child", depth=2, max_depth=2)
        ok, reason = limits.can_spawn(parent, current_total=5, current_children=0)
        self.assertFalse(ok)
        self.assertIn("max_depth", reason)

    def test_refuses_when_parent_max_depth_tighter(self):
        limits = SpawnLimits(max_depth=2)
        parent = _agent(depth=1, max_depth=1, role="captain")
        ok, reason = limits.can_spawn(parent, current_total=2, current_children=0)
        self.assertFalse(ok)
        self.assertIn("max_depth", reason)

    def test_refuses_when_children_at_cap(self):
        limits = SpawnLimits(max_children_per_agent=4)
        ok, reason = limits.can_spawn(_agent(depth=1, role="captain"), current_total=6, current_children=4)
        self.assertFalse(ok)
        self.assertIn("max_children_per_agent", reason)

    def test_refuses_when_total_at_cap(self):
        limits = SpawnLimits(max_agents=24)
        ok, reason = limits.can_spawn(_agent(), current_total=24, current_children=0)
        self.assertFalse(ok)
        self.assertIn("max_agents", reason)

    def test_captain_can_spawn_fourth_child_but_not_fifth(self):
        limits = SpawnLimits(max_depth=2, max_children_per_agent=4, max_agents=24)
        captain = _agent(id="muse", role="captain", depth=1, lineage="arch/muse")
        ok, _ = limits.can_spawn(captain, current_total=6, current_children=3)
        self.assertTrue(ok)
        ok, reason = limits.can_spawn(captain, current_total=7, current_children=4)
        self.assertFalse(ok)
        self.assertIn("max_children_per_agent", reason)

    def test_invalid_counts_fail_closed(self):
        limits = SpawnLimits()
        ok, reason = limits.can_spawn(_agent(), current_total=-1, current_children=0)
        self.assertFalse(ok)
        self.assertIn("current_total", reason)
        ok, reason = limits.can_spawn(_agent(), current_total=1, current_children=-1)
        self.assertFalse(ok)
        self.assertIn("current_children", reason)

    def test_negative_limit_construction_fails_closed(self):
        with self.assertRaises(IdentityError):
            SpawnLimits(max_agents=-1)


if __name__ == "__main__":
    unittest.main()
