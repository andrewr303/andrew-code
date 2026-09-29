"""t2 — per-mode model/effort resolution in the engine.

Proves the precedence contract (explicit arg > active per-mode key > bash
global/baked) and that no-override dispatch is byte-for-byte baseline behavior.
dispatch() is exercised with adapter._bash mocked so no CLI is shelled out; the
test asserts on the exact (model, effort) the adapter WOULD hand the bash layer.
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

from fusion_swarm import adapter  # noqa: E402

MODE_KEYS = [k for k in os.environ if k.startswith("FUSION_") and k.count("_") >= 3]


class _Capture:
    """Mock adapter._bash: record the dispatch argv, write nothing, return ok."""
    def __init__(self):
        self.calls = []

    def __call__(self, argv, timeout=None):
        self.calls.append(argv)
        return (0, "", "")

    def last_model_effort(self):
        # argv: [FUSION_SH, "dispatch", prov, pf, of, model, effort, repo]
        argv = self.calls[-1]
        return argv[5], argv[6]


class ModeOverrides(unittest.TestCase):
    def setUp(self):
        # scrub any FUSION_*_*_MODEL/EFFORT + the marker so tests are hermetic
        for k in list(os.environ):
            if k.startswith("FUSION_") and (k.endswith("_MODEL") or k.endswith("_EFFORT")):
                del os.environ[k]
        os.environ.pop(adapter.INVOKED_MODE_ENV, None)
        self.cap = _Capture()
        self._real_bash = adapter._bash
        adapter._bash = self.cap

    def tearDown(self):
        adapter._bash = self._real_bash
        for k in list(os.environ):
            if k.startswith("FUSION_") and (k.endswith("_MODEL") or k.endswith("_EFFORT")):
                del os.environ[k]
        os.environ.pop(adapter.INVOKED_MODE_ENV, None)

    # -- resolvers -----------------------------------------------------------
    def test_active_env_override_resolves(self):
        os.environ["FUSION_MOA_OPENCODE_MODEL"] = "meta/muse-1.1"
        self.assertEqual(adapter.resolve_model("opencode", "moa"), "meta/muse-1.1")

    def test_empty_override_does_not_mask_global(self):
        os.environ["FUSION_MOA_OPENCODE_MODEL"] = ""
        self.assertEqual(adapter.resolve_model("opencode", "moa"), "")

    def test_no_mode_no_override(self):
        os.environ["FUSION_MOA_OPENCODE_MODEL"] = "meta/muse-1.1"
        self.assertEqual(adapter.resolve_model("opencode", None), "")

    def test_invalid_mode_token_rejected(self):
        os.environ["FUSION_MOA_OPENCODE_MODEL"] = "meta/muse-1.1"
        self.assertEqual(adapter.resolve_model("opencode", "moa; rm -rf /"), "")

    def test_unknown_provider_no_override(self):
        os.environ["FUSION_MOA_BOGUS_MODEL"] = "x"
        self.assertEqual(adapter.resolve_model("bogus", "moa"), "")

    def test_alias_isolation_reflexion(self):
        os.environ["FUSION_REFLEXION_CODEX_MODEL"] = "gpt-x"
        self.assertEqual(adapter.resolve_model("codex", "reflexion"), "gpt-x")
        self.assertEqual(adapter.resolve_model("codex", "moa"), "")

    # -- dispatch injection --------------------------------------------------
    def test_dispatch_injects_active_override(self):
        os.environ["FUSION_MOA_OPENCODE_MODEL"] = "meta/muse-1.1"
        adapter.dispatch("opencode", "hi", mode="moa")
        self.assertEqual(self.cap.last_model_effort()[0], "meta/muse-1.1")

    def test_dispatch_no_override_is_baseline(self):
        # nothing set -> model/effort handed to bash are EMPTY (bash resolves
        # global/baked exactly as before this change).
        adapter.dispatch("opencode", "hi", mode="moa")
        self.assertEqual(self.cap.last_model_effort(), ("", ""))

    def test_explicit_model_beats_override(self):
        os.environ["FUSION_MOA_OPENCODE_MODEL"] = "meta/muse-1.1"
        adapter.dispatch("opencode", "hi", model="explicit/win", mode="moa")
        self.assertEqual(self.cap.last_model_effort()[0], "explicit/win")

    def test_dispatch_reads_process_marker(self):
        os.environ["FUSION_MOA_CODEX_EFFORT"] = "high"
        adapter.set_invoked_mode("moa")
        adapter.dispatch("codex", "hi")  # no explicit mode -> marker used
        self.assertEqual(self.cap.last_model_effort()[1], "high")

    def test_panel_propagates_mode_to_threads(self):
        os.environ["FUSION_MOA_GROK_MODEL"] = "grok-x"
        os.environ["FUSION_MOA_CODEX_MODEL"] = "gpt-x"
        adapter.panel("hi", providers=["codex", "grok"], mode="moa")
        seen = {argv[2]: argv[5] for argv in self.cap.calls}  # provider -> model
        self.assertEqual(seen["grok"], "grok-x")
        self.assertEqual(seen["codex"], "gpt-x")

    def test_set_invoked_mode_roundtrip(self):
        adapter.set_invoked_mode("heavy")
        self.assertEqual(adapter._current_mode(), "heavy")
        adapter.set_invoked_mode(None)
        self.assertIsNone(adapter._current_mode())


if __name__ == "__main__":
    unittest.main()
