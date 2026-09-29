"""t3 — the declarative control schema and per-mode keys in defaults.env.

The load-bearing invariant: the schema's key set equals the config_store
allowlist EXACTLY. A surplus schema key renders a control the writer rejects; a
missing one is a writable key with no control. Either is a silent trap.
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
sys.path.insert(0, str(ROOT / "scripts"))

import dashboard_schema as ds  # noqa: E402
from fusion_swarm import config_store, modes_catalog  # noqa: E402


class DashboardSchema(unittest.TestCase):
    def setUp(self):
        self.schema = ds.build_schema()
        self.by_key = ds.schema_by_key()
        self.allow = set(config_store.parse_defaults().keys())

    def test_schema_keyset_equals_allowlist(self):
        skeys = {d["key"] for d in self.schema}
        self.assertEqual(skeys, self.allow,
                         f"surplus={sorted(skeys - self.allow)} missing={sorted(self.allow - skeys)}")

    def test_no_duplicate_keys(self):
        keys = [d["key"] for d in self.schema]
        self.assertEqual(len(keys), len(set(keys)))

    def test_every_descriptor_has_required_fields(self):
        req = {"key", "widget", "group", "label", "help", "provider",
               "choices", "unit", "custom_allowed", "mode", "field"}
        for d in self.schema:
            self.assertEqual(set(d) >= req, True, f"{d['key']} missing fields")
            self.assertIn(d["widget"], ("model", "enum", "int", "bool", "text"))

    def test_model_widgets_have_no_static_inventory(self):
        # honesty: model options come from live discovery, never the schema.
        for d in self.schema:
            if d["widget"] == "model":
                self.assertIsNone(d["choices"], d["key"])
                self.assertIsNotNone(d["provider"], d["key"])

    def test_grok_effort_is_not_an_enum(self):
        # grok rejects effort -> the (opt-in, global) FUSION_GROK_EFFORT renders
        # as a warning TEXT field, never an enum implying it works; and NO
        # per-mode grok effort key exists at all.
        pm_grok_effort = [d["key"] for d in self.schema
                          if d["mode"] and d["provider"] == "grok" and d["field"] == "EFFORT"]
        self.assertEqual(pm_grok_effort, [])
        d = self.by_key["FUSION_GROK_EFFORT"]
        self.assertEqual(d["widget"], "text")
        self.assertIn("REJECT", d["help"].upper())

    def test_per_mode_descriptors_carry_mode_and_field(self):
        pm = {s["key"] for s in modes_catalog.per_mode_override_specs()}
        for d in self.schema:
            if d["key"] in pm:
                self.assertIsNotNone(d["mode"], d["key"])
                self.assertIn(d["field"], ("MODEL", "EFFORT"))
                self.assertTrue(d["group"].startswith("mode:"))

    def test_defaults_env_per_mode_keys_all_commented(self):
        parsed = config_store.parse_defaults()
        for k in modes_catalog.per_mode_override_keys():
            self.assertIn(k, parsed, k)
            self.assertTrue(parsed[k]["commented"], f"{k} shipped uncommented")
            self.assertEqual(parsed[k]["value"], "", f"{k} shipped non-empty")

    def test_validate_value_rejects_unknown_key(self):
        ok, err, _ = ds.validate_value("FUSION_NOT_A_KEY", "x")
        self.assertFalse(ok)

    def test_validate_value_int(self):
        ok, _, _ = ds.validate_value("FUSION_CODEX_TIMEOUT", "900")
        self.assertTrue(ok)
        ok, _, _ = ds.validate_value("FUSION_CODEX_TIMEOUT", "abc")
        self.assertFalse(ok)

    def test_validate_value_enum_custom_flagged(self):
        ok, _, custom = ds.validate_value("FUSION_META_WORKSPACE_MODE", "proposal")
        self.assertTrue(ok)
        self.assertFalse(custom)
        ok, _, custom = ds.validate_value("FUSION_META_WORKSPACE_MODE", "something-else")
        self.assertTrue(ok)      # custom escape hatch
        self.assertTrue(custom)  # ...but flagged unverified

    def test_group_order_covers_all_groups(self):
        groups = {g["id"] for g in ds.group_order()}
        schema_groups = {d["group"] for d in self.schema}
        self.assertEqual(groups, schema_groups)


if __name__ == "__main__":
    unittest.main()
