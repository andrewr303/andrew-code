"""Offline tests for Kimi / AndrewCode plugin install (kimi.plugin.json + install-kimi.py).

No paid CLI calls. Copies into a temp ANDREWCODE_HOME.
"""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]


def _load_installer():
    import importlib.util
    path = _ROOT / "scripts" / "install-kimi.py"
    spec = importlib.util.spec_from_file_location("fusion_install_kimi", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


install_kimi = _load_installer()


class TestKimiManifest(unittest.TestCase):
    def test_root_manifest_parses(self):
        path = _ROOT / "kimi.plugin.json"
        self.assertTrue(path.is_file(), path)
        data = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(data["name"], "fusion")
        self.assertTrue(data["skills"].startswith("./"))
        self.assertTrue(data["commands"].startswith("./"))
        self.assertEqual(data["systemPromptPath"], "./SYSTEM.md")
        self.assertTrue((_ROOT / "SYSTEM.md").is_file())
        self.assertNotIn("tools", data)
        self.assertNotIn("apps", data)

    def test_dir_manifest_matches_root(self):
        root = json.loads((_ROOT / "kimi.plugin.json").read_text(encoding="utf-8"))
        alt = json.loads((_ROOT / ".kimi-plugin" / "plugin.json").read_text(encoding="utf-8"))
        self.assertEqual(root["name"], alt["name"])
        self.assertEqual(root["skills"], alt["skills"])
        self.assertEqual(root["commands"], alt["commands"])


class TestKimiInstaller(unittest.TestCase):
    def test_dry_run_does_not_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            dest = install_kimi.install(_ROOT, home, dry_run=True)
            self.assertFalse(dest.exists())
            self.assertFalse((home / "plugins" / "installed.json").exists())

    def test_install_copies_surface_not_vendors(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            dest = install_kimi.install(_ROOT, home, dry_run=False)
            self.assertTrue((dest / "kimi.plugin.json").is_file())
            self.assertTrue((dest / "SYSTEM.md").is_file())
            self.assertTrue((dest / "skills" / "fusion-hive" / "SKILL.md").is_file())
            self.assertTrue((dest / "commands" / "hive.md").is_file())
            self.assertTrue((dest / "python" / "fusion_swarm" / "hive.py").is_file())
            self.assertTrue((dest / "scripts" / "fusion.sh").is_file())
            self.assertFalse((dest / "kimi-code").exists(), "vendor tree must not be copied")
            self.assertFalse((dest / "andrewagent").exists())
            self.assertFalse((dest / "cccc").exists())
            installed = json.loads((home / "plugins" / "installed.json").read_text(encoding="utf-8"))
            ids = [p["id"] for p in installed["plugins"]]
            self.assertIn("fusion", ids)
            rec = next(p for p in installed["plugins"] if p["id"] == "fusion")
            self.assertTrue(rec["enabled"])
            self.assertEqual(rec["source"], "local-path")
            self.assertEqual(Path(rec["root"]), dest)

    def test_reinstall_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp) / "home"
            install_kimi.install(_ROOT, home, dry_run=False)
            install_kimi.install(_ROOT, home, dry_run=False)
            installed = json.loads((home / "plugins" / "installed.json").read_text(encoding="utf-8"))
            fusions = [p for p in installed["plugins"] if p["id"] == "fusion"]
            self.assertEqual(len(fusions), 1)


if __name__ == "__main__":
    unittest.main()
