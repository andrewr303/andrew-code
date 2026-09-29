"""t1 gate — the invoked-mode -> engine-pattern -> provider roster contract.

Deterministic guard for the roster contract the whole dashboard upgrade hangs
off. Fails loudly if the moa misclassification regresses, if an engine pattern
loses its provider mapping, or if the bounded per-mode key set drifts.
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from fusion_swarm import modes_catalog as mc  # noqa: E402


class ModeContractMap(unittest.TestCase):
    def setUp(self):
        self.modes = {m["mode"]: m for m in mc.all_modes()}

    def test_moa_is_not_misclassified_as_dynamic(self):
        # The regression this whole gate exists for: commands/moa.md mentions
        # `swarm.sh roster` before `swarm.sh moa`; first-match detection wrongly
        # returned None.
        self.assertEqual(self.modes["moa"]["engine_pattern"], "moa")

    def test_detect_returns_first_real_pattern_not_first_token(self):
        body = "run `swarm.sh roster --json` then `swarm.sh moa` finally"
        self.assertEqual(mc._detect_engine_pattern(body), "moa")

    def test_non_engine_modes_stay_dynamic(self):
        for m in ("council", "vote", "panel", "debate", "huddle", "fusion"):
            self.assertIsNone(self.modes[m]["engine_pattern"], m)

    def test_every_engine_pattern_has_a_roster_entry(self):
        for name, entry in self.modes.items():
            pat = entry["engine_pattern"]
            if pat is None:
                continue
            self.assertIn(pat, mc.ENGINE_PATTERN_PROVIDERS,
                          f"engine pattern {pat!r} (mode {name}) lacks a roster classification")

    def test_engine_providers_are_known_providers(self):
        for pat, provs in mc.ENGINE_PATTERN_PROVIDERS.items():
            for p in provs:
                self.assertIn(p, mc.PROVIDER_NAMES, f"{pat} -> unknown provider {p}")

    def test_gate_dispatches_no_panelist(self):
        self.assertEqual(mc.engine_providers("gate"), [])

    def test_per_mode_keys_bounded_and_unique(self):
        keys = mc.per_mode_override_keys()
        self.assertEqual(len(keys), len(set(keys)), "duplicate per-mode keys")
        # exactly MODEL for every dispatched provider + EFFORT only for
        # effort-capable providers; grok/agy EFFORT and gate keys never appear.
        self.assertFalse([k for k in keys if "GROK_EFFORT" in k])
        self.assertFalse([k for k in keys if "AGY_EFFORT" in k])
        self.assertFalse([k for k in keys if k.startswith("FUSION_GATE_")])

    def test_per_mode_specs_match_roster_contract(self):
        specs = mc.per_mode_override_specs()
        for s in specs:
            self.assertIn(s["provider"], mc.engine_providers(s["pattern"]))
            self.assertTrue(s["key"].startswith(f"FUSION_{s['pattern'].upper()}_"))
            if s["field"] == "EFFORT":
                self.assertIn(s["provider"], mc.EFFORT_CAPABLE_PROVIDERS)

    def test_reason_command_maps_to_reflexion_keys(self):
        # the one command!=pattern case: keys are pattern-keyed so the engine
        # reads exactly what the dashboard writes.
        specs = mc.per_mode_override_specs()
        reflexion = [s for s in specs if s["pattern"] == "reflexion"]
        self.assertTrue(reflexion)
        self.assertTrue(all(s["command"] == "reason" for s in reflexion))
        self.assertTrue(all(s["key"].startswith("FUSION_REFLEXION_") for s in reflexion))

    def test_mode_token_uses_invoked_name(self):
        self.assertEqual(mc.mode_token("moa"), "MOA")
        self.assertEqual(mc.mode_token("best-of"), "BEST_OF")


if __name__ == "__main__":
    unittest.main()
