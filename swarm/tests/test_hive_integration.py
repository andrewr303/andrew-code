"""Slice Q — offline nested-hive integration test.

Builds a nested-hive SwarmSpec (muse + glm, 4 children each), dry-runs
``fusion_swarm.hive.run`` (no subprocess, no paid CLI), then uses HiveBoard
to prove:

  * children of muse can DM children of glm
  * the architect, even when joined to ``hive``, does NOT see the DM body
  * the architect DOES see a child's subsequent hive post
  * the tree has 2 captains + 8 children
  * SpawnLimits refuse a 5th child of a captain that already has 4

No live paid CLI calls. Skip/fail clearly if a sibling hive module is missing.

Run:  python -m unittest tests.test_hive_integration      (from the plugin root)
  or: python tests/test_hive_integration.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "python"))


# Import at module load so a missing sibling is a skip, not a collection crash.
try:
    from fusion_swarm.board import HiveBoard  # noqa: E402
except ImportError as _exc:  # pragma: no cover - skip path
    HiveBoard = None  # type: ignore[assignment]
    _BOARD_IMPORT_ERROR = _exc
else:
    _BOARD_IMPORT_ERROR = None

try:
    from fusion_swarm.identities import (  # noqa: E402
        AgentIdentity,
        SpawnLimits,
    )
except ImportError as _exc:  # pragma: no cover - skip path
    AgentIdentity = None  # type: ignore[assignment]
    SpawnLimits = None  # type: ignore[assignment]
    _IDENT_IMPORT_ERROR = _exc
else:
    _IDENT_IMPORT_ERROR = None

try:
    from fusion_swarm.designer import (  # noqa: E402
        SwarmSpec,
        parse_swarm_spec,
        validate_spec,
    )
except ImportError as _exc:  # pragma: no cover - skip path
    SwarmSpec = None  # type: ignore[assignment]
    parse_swarm_spec = None  # type: ignore[assignment]
    validate_spec = None  # type: ignore[assignment]
    _DESIGNER_IMPORT_ERROR = _exc
else:
    _DESIGNER_IMPORT_ERROR = None

try:
    from fusion_swarm import hive as hive_mod  # noqa: E402
except ImportError as _exc:  # pragma: no cover - skip path
    hive_mod = None  # type: ignore[assignment]
    _HIVE_IMPORT_ERROR = _exc
else:
    _HIVE_IMPORT_ERROR = None


# Providers the slice names. Validation is fail-closed against a live roster;
# tests never probe CLIs, so this is the declared (not "detected live") set.
LIVE_ROSTER = [
    "fable",
    "codex",
    "andrewcode",
    "opencode",
    "grok",
    "copilot",
    "kimi",
    "host",
]

TASK = "nested-hive integration: muse and glm each spawn 4 andrewcode children"

# Secret body used for the cross-captain DM. Must not leak into the architect
# hive poll.
DM_BODY = "secret-cross-lineage-dm-from-muse-1-to-glm-1"
HIVE_BODY = "progress: muse-1 posted this on hive for the architect"


def _require_modules() -> None:
    missing = []
    if _BOARD_IMPORT_ERROR is not None:
        missing.append(f"fusion_swarm.board ({_BOARD_IMPORT_ERROR})")
    if _IDENT_IMPORT_ERROR is not None:
        missing.append(f"fusion_swarm.identities ({_IDENT_IMPORT_ERROR})")
    if _DESIGNER_IMPORT_ERROR is not None:
        missing.append(f"fusion_swarm.designer ({_DESIGNER_IMPORT_ERROR})")
    if _HIVE_IMPORT_ERROR is not None:
        missing.append(f"fusion_swarm.hive ({_HIVE_IMPORT_ERROR})")
    if missing:
        raise unittest.SkipTest(
            "missing hive module(s): " + "; ".join(missing)
        )


def nested_hive_spec() -> "SwarmSpec":
    """Canonical two-captain nested-hive SwarmSpec for this slice.

    Captains:
      * muse  — andrewcode / meta/muse-spark-1.3-contributor, spawn 4
      * glm   — opencode / opencode-go/glm-5.3, spawn 4, spawn_via andrewcode
    """
    # Build via parse_swarm_spec so markdown-fence extraction is also exercised
    # if a later caller wraps this JSON. Bare object is valid too.
    payload = {
        "name": "nested-hive",
        "architect": {"provider": "fable", "model": "fable-5.1"},
        "operator": {"provider": "codex", "model": "gpt-6-astra"},
        "captains": [
            {
                "id": "muse",
                "provider": "andrewcode",
                "model": "meta/muse-spark-1.3-contributor",
                "spawn": 4,
                "spawn_via": "andrewcode",
            },
            {
                "id": "glm",
                "provider": "opencode",
                "model": "opencode-go/glm-5.3",
                "spawn": 4,
                "spawn_via": "andrewcode",
            },
        ],
        "cross_talk": True,
        "board": True,
        "max_depth": 2,
        "max_children_per_agent": 4,
        "max_agents": 24,
        "budget": {},
        "communication": "open",
        "task": TASK,
        "notes": (
            "Integration fixture: two captains, eight andrewcode children, "
            "open Hive Board, DMs private, hive posts public."
        ),
    }
    return parse_swarm_spec(
        "```json\n"
        + json.dumps(payload, indent=2)
        + "\n```"
    )


def _agent_ids(agents, *, role: str | None = None, parent_id: str | None = None):
    out = []
    for rec in agents:
        if role is not None and rec.get("role") != role:
            continue
        if parent_id is not None and rec.get("parent_id") != parent_id:
            continue
        out.append(rec["id"])
    return out


def _by_id(agents):
    return {a["id"]: a for a in agents}


def _tree_children(tree, parent_id: str):
    kids = (tree.get("children") or {}).get(parent_id) or []
    return list(kids)


class TestHiveIntegrationModulesPresent(unittest.TestCase):
    """Fail clearly (not skip) only when the test file itself is broken.

    Missing sibling modules skip the scenario tests below so a partial
    overhaul checkout stays honest: absent ≠ agreement.
    """

    def test_import_surface(self):
        # These four are the integration surface. If they are missing the
        # scenario class skips; this test documents which ones landed.
        landed = {
            "board": _BOARD_IMPORT_ERROR is None,
            "identities": _IDENT_IMPORT_ERROR is None,
            "designer": _DESIGNER_IMPORT_ERROR is None,
            "hive": _HIVE_IMPORT_ERROR is None,
        }
        # Always assert the dict shape so the test is not a no-op when all
        # land. A fully-landed tree must import all four.
        if all(landed.values()):
            self.assertTrue(landed["board"])
            self.assertTrue(callable(getattr(hive_mod, "run", None)))
            self.assertTrue(callable(parse_swarm_spec))
            self.assertTrue(callable(HiveBoard))
        else:
            missing = [name for name, ok in landed.items() if not ok]
            raise unittest.SkipTest(
                "hive integration modules not all landed: " + ", ".join(missing)
            )


class TestNestedHiveDryRun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _require_modules()
        cls.spec = nested_hive_spec()
        errs = validate_spec(cls.spec, LIVE_ROSTER)
        if errs:
            raise AssertionError(
                "SwarmSpec failed validate_spec against the declared roster: "
                + "; ".join(errs)
            )
        # hive.run validates the spec against its own ``_live_roster()``. That
        # helper is offline-safe (it does not probe CLIs) and therefore does
        # not look like a provider list. Patch it to the declared roster so
        # dry_run can execute without pretending a CLI is live. Tests never
        # call detect.sh or paid endpoints.
        cls._orig_roster = getattr(hive_mod, "_live_roster", None)

        def _declared_roster():
            return {p: {"provider": p} for p in LIVE_ROSTER}

        hive_mod._live_roster = _declared_roster
        cls._tmp = tempfile.TemporaryDirectory()
        try:
            cls.result = hive_mod.run(
                TASK,
                spec=cls.spec,
                dry_run=True,
                state_dir=cls._tmp.name,
            )
        except Exception:
            cls._tmp.cleanup()
            if cls._orig_roster is not None:
                hive_mod._live_roster = cls._orig_roster
            raise
        if not isinstance(cls.result, dict) or cls.result.get("pattern") != "hive":
            cls._tmp.cleanup()
            if cls._orig_roster is not None:
                hive_mod._live_roster = cls._orig_roster
            raise AssertionError(
                f"hive.run did not return a hive result dict: {cls.result!r}"
            )
        if cls.result.get("design"):
            cls._tmp.cleanup()
            if cls._orig_roster is not None:
                hive_mod._live_roster = cls._orig_roster
            raise AssertionError(
                "hive.run returned a design packet instead of executing the "
                "supplied SwarmSpec (dry_run should still build the tree + board)"
            )
        cls.board_path = cls.result["board_path"]
        cls.board = HiveBoard(cls.board_path)

    @classmethod
    def tearDownClass(cls):
        orig = getattr(cls, "_orig_roster", None)
        if orig is not None:
            hive_mod._live_roster = orig
        board = getattr(cls, "board", None)
        if board is not None:
            try:
                board.close()
            except Exception:
                pass
        tmp = getattr(cls, "_tmp", None)
        if tmp is not None:
            tmp.cleanup()

    def test_result_shape(self):
        res = self.result
        self.assertEqual(res["pattern"], "hive")
        self.assertTrue(res.get("run_id"))
        self.assertTrue(os.path.isfile(res["board_path"]))
        self.assertTrue(res.get("dry_run") is True)
        self.assertIn("spec", res)
        self.assertIn("agents", res)
        self.assertIn("tree", res)
        self.assertIn("posts_seeded", res)
        spec = res["spec"]
        self.assertEqual(spec.get("name"), "nested-hive")
        captains = spec.get("captains") or []
        ids = [c.get("id") for c in captains]
        self.assertIn("muse", ids)
        self.assertIn("glm", ids)
        muse = next(c for c in captains if c.get("id") == "muse")
        glm = next(c for c in captains if c.get("id") == "glm")
        self.assertEqual(muse.get("provider"), "andrewcode")
        self.assertEqual(muse.get("model"), "meta/muse-spark-1.3-contributor")
        self.assertEqual(int(muse.get("spawn")), 4)
        self.assertEqual(muse.get("spawn_via"), "andrewcode")
        self.assertEqual(glm.get("provider"), "opencode")
        self.assertEqual(glm.get("model"), "opencode-go/glm-5.3")
        self.assertEqual(int(glm.get("spawn")), 4)
        self.assertEqual(glm.get("spawn_via"), "andrewcode")

    def test_no_subprocess_on_dry_run(self):
        # Dry-run must not claim live handles. hive.run only adds "spawned"
        # when it actually called spawn.py.
        self.assertNotIn("spawned", self.result)

    def test_tree_has_two_captains_and_eight_children(self):
        agents = self.result["agents"]
        tree = self.result["tree"]
        by_id = _by_id(agents)

        self.assertIn("muse", by_id)
        self.assertIn("glm", by_id)
        self.assertEqual(by_id["muse"]["role"], "captain")
        self.assertEqual(by_id["glm"]["role"], "captain")
        self.assertEqual(by_id["muse"]["provider"], "andrewcode")
        self.assertEqual(by_id["glm"]["provider"], "opencode")

        captains = _agent_ids(agents, role="captain")
        self.assertEqual(sorted(captains), ["glm", "muse"])

        muse_kids = _tree_children(tree, "muse")
        glm_kids = _tree_children(tree, "glm")
        self.assertEqual(len(muse_kids), 4, muse_kids)
        self.assertEqual(len(glm_kids), 4, glm_kids)

        # Children are andrewcode identities even when the captain is glm/opencode.
        for kid in muse_kids + glm_kids:
            self.assertEqual(kid["role"], "child")
            self.assertEqual(kid["provider"], "andrewcode")
            self.assertEqual(kid["parent_id"] in ("muse", "glm"), True)

        child_ids = _agent_ids(agents, role="child")
        self.assertEqual(len(child_ids), 8)
        self.assertEqual(len(set(child_ids)), 8)

        # Architect parented both captains.
        arch_kids = _tree_children(tree, "arch")
        arch_kid_ids = {c["id"] for c in arch_kids}
        self.assertIn("muse", arch_kid_ids)
        self.assertIn("glm", arch_kid_ids)

    def test_children_named_under_captain(self):
        muse_kids = sorted(_agent_ids(self.result["agents"], parent_id="muse"))
        glm_kids = sorted(_agent_ids(self.result["agents"], parent_id="glm"))
        self.assertEqual(muse_kids, ["muse-1", "muse-2", "muse-3", "muse-4"])
        self.assertEqual(glm_kids, ["glm-1", "glm-2", "glm-3", "glm-4"])

    def test_spawn_limits_refuse_fifth_child(self):
        limits = SpawnLimits(
            max_depth=2, max_children_per_agent=4, max_agents=24
        )
        muse = AgentIdentity.from_dict(
            {k: v for k, v in _by_id(self.result["agents"])["muse"].items()
             if k in AgentIdentity.__dataclass_fields__}
        )
        # 4 children already registered; a 5th must be refused.
        current_total = len(self.result["agents"])
        ok, reason = limits.can_spawn(
            muse, current_total=current_total, current_children=4
        )
        self.assertFalse(ok)
        self.assertIn("max_children_per_agent", reason)

        # The 4th child of a captain that currently has 3 would still be allowed.
        ok4, reason4 = limits.can_spawn(
            muse, current_total=current_total - 1, current_children=3
        )
        self.assertTrue(ok4, reason4)
        self.assertEqual(reason4, "")

        glm = AgentIdentity.from_dict(
            {k: v for k, v in _by_id(self.result["agents"])["glm"].items()
             if k in AgentIdentity.__dataclass_fields__}
        )
        ok_glm, reason_glm = limits.can_spawn(
            glm, current_total=current_total, current_children=4
        )
        self.assertFalse(ok_glm)
        self.assertIn("max_children_per_agent", reason_glm)

    def test_cross_captain_dm_is_private_hive_post_is_not(self):
        board = self.board
        agents = _by_id(self.result["agents"])
        self.assertIn("muse-1", agents)
        self.assertIn("glm-1", agents)
        self.assertIn("arch", agents)

        # Architect is joined to hive (role auto-join + hive.run joins).
        # Confirm by posting nothing yet — poll hive traffic from dry-run seed.
        arch_before = board.poll("arch")
        self.assertTrue(
            any(m.get("channel") == "hive" for m in arch_before),
            "architect must already be on hive (seeded task post)",
        )

        dm = board.dm("muse-1", "glm-1", DM_BODY)
        self.assertEqual(dm["from_agent"], "muse-1")
        self.assertEqual(dm["to_agent"], "glm-1")
        self.assertEqual(dm["body"], DM_BODY)
        self.assertTrue(dm["channel"].startswith("dm:"))
        # Canonical channel is sorted ids.
        a, b = sorted(("muse-1", "glm-1"))
        self.assertEqual(dm["channel"], f"dm:{a}:{b}")

        muse_feed = board.poll("muse-1")
        glm_feed = board.poll("glm-1")
        self.assertTrue(any(m["body"] == DM_BODY for m in muse_feed))
        self.assertTrue(any(m["body"] == DM_BODY for m in glm_feed))

        # Architect joined hive — DMs are private. Architect must NOT see the
        # DM body via poll (joined rooms + DMs-to-self + @mentions only).
        arch_after_dm = board.poll("arch")
        self.assertFalse(
            any(m.get("body") == DM_BODY for m in arch_after_dm),
            "architect poll leaked a private DM body",
        )
        self.assertFalse(
            any(m.get("channel", "").startswith("dm:") for m in arch_after_dm),
            "architect poll included a DM channel it did not join",
        )

        # A child post to hive IS visible to the architect.
        hive_post = board.post(
            from_agent="muse-1",
            body=HIVE_BODY,
            channel="hive",
        )
        self.assertEqual(hive_post["channel"], "hive")
        self.assertEqual(hive_post["body"], HIVE_BODY)

        arch_after_hive = board.poll("arch")
        self.assertTrue(
            any(m.get("body") == HIVE_BODY and m.get("channel") == "hive"
                for m in arch_after_hive),
            "architect on hive must see a child's hive post",
        )
        # Still must not see the DM body after the hive post.
        self.assertFalse(
            any(m.get("body") == DM_BODY for m in arch_after_hive)
        )

        # glm-1 (joined to hive) also sees the hive post, plus its DM.
        glm_after = board.poll("glm-1")
        self.assertTrue(any(m.get("body") == DM_BODY for m in glm_after))
        self.assertTrue(
            any(m.get("body") == HIVE_BODY and m.get("channel") == "hive"
                for m in glm_after)
        )

        # A DM is not an @mention of the architect.
        hits = board.mentions("arch")
        self.assertFalse(any(m.get("body") == DM_BODY for m in hits))


class TestNestedHiveSpecContract(unittest.TestCase):
    """Spec construction + SpawnLimits even if hive.run is missing.

    Keeps the slice honest when only designer/identities have landed.
    """

    def test_spec_parses_and_validates(self):
        if _DESIGNER_IMPORT_ERROR is not None:
            raise unittest.SkipTest(
                f"fusion_swarm.designer missing ({_DESIGNER_IMPORT_ERROR})"
            )
        spec = nested_hive_spec()
        self.assertIsInstance(spec, SwarmSpec)
        self.assertEqual(spec.name, "nested-hive")
        self.assertEqual(len(spec.captains), 2)
        self.assertEqual(spec.captains[0].id, "muse")
        self.assertEqual(spec.captains[0].provider, "andrewcode")
        self.assertEqual(spec.captains[0].model, "meta/muse-spark-1.3-contributor")
        self.assertEqual(spec.captains[0].spawn, 4)
        self.assertEqual(spec.captains[0].spawn_via, "andrewcode")
        self.assertEqual(spec.captains[1].id, "glm")
        self.assertEqual(spec.captains[1].provider, "opencode")
        self.assertEqual(spec.captains[1].model, "opencode-go/glm-5.3")
        self.assertEqual(spec.captains[1].spawn, 4)
        self.assertEqual(spec.captains[1].spawn_via, "andrewcode")
        self.assertTrue(spec.cross_talk)
        self.assertTrue(spec.board)
        self.assertEqual(spec.communication, "open")
        errs = validate_spec(spec, LIVE_ROSTER)
        self.assertEqual(errs, [], errs)

    def test_spawn_limits_fifth_child_without_hive(self):
        if _IDENT_IMPORT_ERROR is not None:
            raise unittest.SkipTest(
                f"fusion_swarm.identities missing ({_IDENT_IMPORT_ERROR})"
            )
        limits = SpawnLimits(max_depth=2, max_children_per_agent=4, max_agents=24)
        muse = AgentIdentity(
            id="muse",
            display_name="muse",
            role="captain",
            provider="andrewcode",
            model="meta/muse-spark-1.3-contributor",
            parent_id="arch",
            lineage="arch/muse",
            depth=1,
            spawn_budget=0,
            max_depth=2,
        )
        ok, reason = limits.can_spawn(muse, current_total=12, current_children=4)
        self.assertFalse(ok)
        self.assertIn("max_children_per_agent", reason)


if __name__ == "__main__":
    unittest.main()
