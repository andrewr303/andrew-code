"""Offline tests for Fusion Hive docs and plugin manifests (slice N).

No CLIs, no network. Asserts the README Hive section, docs/HIVE.md contract
coverage, and 3.0.0+hive manifests/keywords.

Run:  python -m unittest tests.test_hive_docs      (from the plugin root)
  or: python tests/test_hive_docs.py
"""
from __future__ import annotations

import json
import os
import unittest

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

VERSION = "3.0.0+hive"
REQUIRED_KEYWORDS = ("hive", "andrewcode", "nested-swarm", "astra", "board")

MANIFESTS = (
    os.path.join(_ROOT, ".claude-plugin", "plugin.json"),
    os.path.join(_ROOT, ".codex-plugin", "plugin.json"),
    os.path.join(_ROOT, ".claude-plugin", "marketplace.json"),
)

KIMI_MANIFESTS = (
    os.path.join(_ROOT, "kimi.plugin.json"),
    os.path.join(_ROOT, ".kimi-plugin", "plugin.json"),
)

README = os.path.join(_ROOT, "README.md")
HIVE = os.path.join(_ROOT, "docs", "HIVE.md")


def _read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def _load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class TestHiveManifests(unittest.TestCase):
    def test_manifests_exist(self):
        for path in MANIFESTS:
            self.assertTrue(os.path.isfile(path), path)

    def test_version_is_hive(self):
        plugin = _load_json(MANIFESTS[0])
        codex = _load_json(MANIFESTS[1])
        market = _load_json(MANIFESTS[2])
        self.assertEqual(plugin["version"], VERSION)
        self.assertEqual(codex["version"], VERSION)
        self.assertEqual(market["metadata"]["version"], VERSION)
        self.assertEqual(market["plugins"][0]["version"], VERSION)

    def test_keywords_on_every_manifest(self):
        plugin = _load_json(MANIFESTS[0])
        codex = _load_json(MANIFESTS[1])
        market = _load_json(MANIFESTS[2])
        for label, kws in (
            ("claude plugin.json", plugin["keywords"]),
            ("codex plugin.json", codex["keywords"]),
            ("marketplace plugin", market["plugins"][0]["keywords"]),
        ):
            missing = [k for k in REQUIRED_KEYWORDS if k not in kws]
            self.assertEqual(missing, [], f"{label} missing {missing}")

    def test_descriptions_name_hive_and_andrewcode(self):
        plugin = _load_json(MANIFESTS[0])
        codex = _load_json(MANIFESTS[1])
        market = _load_json(MANIFESTS[2])
        blobs = [
            plugin["description"],
            codex["description"],
            codex["interface"]["longDescription"],
            market["metadata"]["description"],
            market["plugins"][0]["description"],
        ]
        for blob in blobs:
            lower = blob.lower()
            self.assertIn("hive", lower, blob[:80])
            self.assertIn("andrewcode", lower, blob[:80])

    def test_old_metaloop_version_is_gone(self):
        for path in MANIFESTS:
            raw = _read(path)
            self.assertNotIn("2.1.0+metaloop", raw, path)

    def test_claude_plugin_keeps_core_fields(self):
        plugin = _load_json(MANIFESTS[0])
        self.assertEqual(plugin["name"], "fusion")
        self.assertEqual(plugin["displayName"], "Fusion")
        self.assertEqual(plugin["license"], "MIT")
        self.assertIn("metaloop", plugin["keywords"])
        self.assertIn("fable", plugin["keywords"])

    def test_codex_plugin_keeps_interface_and_skills(self):
        codex = _load_json(MANIFESTS[1])
        self.assertEqual(codex["skills"], "./skills/")
        iface = codex["interface"]
        self.assertEqual(iface["displayName"], "Fusion")
        self.assertIn("logo", iface)
        self.assertIn("Hive", iface["shortDescription"] + iface["longDescription"])
        prompts = " ".join(iface["defaultPrompt"])
        self.assertIn("Hive", prompts)

    def test_marketplace_plugin_entry_points_at_root(self):
        market = _load_json(MANIFESTS[2])
        self.assertEqual(market["plugins"][0]["name"], "fusion")
        self.assertEqual(market["plugins"][0]["source"], "./")
        self.assertEqual(market["plugins"][0]["category"], "orchestration")

    def test_kimi_manifests_exist_and_match_contract(self):
        for path in KIMI_MANIFESTS:
            self.assertTrue(os.path.isfile(path), path)
            data = _load_json(path)
            self.assertEqual(data["name"], "fusion")
            self.assertEqual(data["version"], VERSION)
            self.assertEqual(data["skills"], "./skills/")
            self.assertEqual(data["commands"], "./commands/")
            self.assertEqual(data["systemPromptPath"], "./SYSTEM.md")
            self.assertTrue(os.path.isfile(os.path.join(_ROOT, "SYSTEM.md")))
            kws = data.get("keywords") or []
            missing = [k for k in REQUIRED_KEYWORDS if k not in kws]
            self.assertEqual(missing, [], f"{path} missing {missing}")
            iface = data.get("interface") or {}
            blob = " ".join([
                data.get("description") or "",
                iface.get("shortDescription") or "",
                iface.get("longDescription") or "",
            ]).lower()
            self.assertIn("hive", blob)
            self.assertIn("andrewcode", blob)
            self.assertNotIn("tools", data)
            self.assertNotIn("apps", data)


class TestReadmeHiveSection(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read(README)

    def test_hive_heading_is_prominent(self):
        self.assertIn("## Hive — nested AndrewCode swarm on one board", self.text)
        self.assertIn("docs/HIVE.md", self.text)

    def test_four_captain_eight_child_example(self):
        text = self.text
        self.assertIn("muse-spark-1.3", text)
        self.assertIn("glm-5.3", text)
        self.assertIn("4 nested AndrewCode children", text)
        self.assertIn("4-captain / 8-child", text)
        self.assertIn("captain grok", text)
        self.assertIn("captain copilot", text)

    def test_architect_latitude(self):
        self.assertIn("Architect latitude", self.text)
        self.assertIn("hard constraints", self.text.lower())
        self.assertIn("SwarmSpec", self.text)
        self.assertIn("SpawnLimits", self.text)
        self.assertIn("gpt-6-astra", self.text)
        self.assertIn("Fable 5.1", self.text)

    def test_mode_tables_keep_original_six(self):
        self.assertIn("## Collaboration modes", self.text)
        for mode in ("**solo**", "**panel**", "**council**", "**debate**", "**vote**", "**swarm**"):
            self.assertIn(mode, self.text, mode)

    def test_hive_designer_board_rows_on_mode_tables(self):
        self.assertIn("| **hive** |", self.text)
        self.assertIn("| **designer** |", self.text)
        self.assertIn("| **board** |", self.text)
        self.assertIn("| `/fusion:hive` |", self.text)
        self.assertIn("| `/fusion:designer` |", self.text)
        self.assertIn("| `/fusion:board` |", self.text)

    def test_existing_advanced_swarm_rows_kept(self):
        for cmd in (
            "`/fusion:moa`",
            "`/fusion:heavy`",
            "`/fusion:discuss`",
            "`/fusion:ladder`",
            "`/fusion:speclock`",
            "`/fusion:breaker`",
            "`/fusion:ballot`",
            "`/fusion:gate`",
            "`/fusion:metaloop`",
            "`/fusion:graph`",
            "`/fusion:ultraswarm`",
            "`/fusion:ultimate-review`",
        ):
            self.assertIn(cmd, self.text, cmd)

    def test_board_cli_and_honesty(self):
        self.assertIn('python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"', self.text)
        self.assertIn("absent ≠", self.text.lower())
        self.assertIn("real dispatch only", self.text.lower())
        self.assertIn("--dry-run", self.text)
        self.assertIn("andrewcode -p", self.text)

    def test_quick_start_and_layout_mention_hive(self):
        self.assertIn("/fusion:hive", self.text)
        self.assertIn("python/fusion_swarm/", self.text)
        self.assertIn("identities.py · board.py · spawn.py · designer.py · hive.py · hive_prompts.py", self.text)
        self.assertIn("docs/HIVE.md", self.text)
        self.assertIn("test_hive_docs.py", self.text)

    def test_does_not_delete_install_or_credit(self):
        self.assertIn("## Install", self.text)
        self.assertIn("## Quick start", self.text)
        self.assertIn("## How a run works", self.text)
        self.assertIn("## What makes it good (and honest)", self.text)
        self.assertIn("## Configuration", self.text)
        self.assertIn("## Layout", self.text)
        self.assertIn("## Credit", self.text)
        self.assertIn("MIT licensed.", self.text)
        self.assertIn("AndrewAgent", self.text)
        self.assertIn("CODEX.md", self.text)
        self.assertIn("KIMI.md", self.text)
        self.assertIn("kimi.plugin.json", self.text)


class TestHiveDoc(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = _read(HIVE)
        cls.lower = cls.text.lower()

    def test_file_exists_and_titled(self):
        self.assertTrue(os.path.isfile(HIVE), HIVE)
        self.assertTrue(self.text.startswith("# Fusion Hive"))

    def test_architecture_section(self):
        self.assertIn("## Architecture", self.text)
        self.assertIn("architect", self.lower)
        self.assertIn("captain", self.lower)
        self.assertIn("operator", self.lower)
        self.assertIn("AgentIdentity", self.text)
        self.assertIn("python/fusion_swarm/identities.py", self.text)
        for role in ("architect", "operator", "captain", "worker", "child"):
            self.assertIn(role, self.text)

    def test_sqlite_schema_overview(self):
        self.assertIn("## Hive Board", self.text)
        self.assertIn("### Schema overview", self.text)
        for table in ("agents", "channels", "channel_members", "messages", "acks", "presence"):
            self.assertIn(f"`{table}`", self.text, table)
        for ch in ("`hive`", "`architect`", "`captains`", "`workers`", "`system`"):
            self.assertIn(ch, self.text, ch)
        self.assertIn("WAL", self.text)
        self.assertIn("no daemon", self.lower)
        self.assertIn(".jsonl", self.text)
        self.assertIn("dm:<sorted_a>:<sorted_b>", self.text)
        self.assertIn("lineage-<captain>", self.text)
        self.assertIn("task-main", self.text)
        for kind in ("room", "dm", "thread", "lineage", "task"):
            self.assertIn(kind, self.text)

    def test_board_methods_documented(self):
        for meth in (
            "init_schema", "register", "heartbeat", "ensure_channel", "join",
            "post", "dm", "reply", "poll", "mentions", "agents", "tree",
            "ack", "format_feed", "close",
        ):
            self.assertIn(meth, self.text, meth)

    def test_spawn_tree_and_env_vars(self):
        self.assertIn("## Spawn tree", self.text)
        self.assertIn("SpawnHandle", self.text)
        self.assertIn("spawn_andrewcode", self.text)
        self.assertIn("spawn_via_adapter", self.text)
        self.assertIn("SpawnLimits", self.text)
        self.assertIn("C:/Users/Andrew/.andrewcode/bin/andrewcode", self.text)
        self.assertIn("--auto", self.text)
        self.assertIn("--yolo", self.text)
        self.assertIn("--output-format text", self.text)
        for env in (
            "FUSION_BOARD", "FUSION_AGENT_ID", "FUSION_PARENT_ID",
            "FUSION_SWARM_ID", "PYTHONPATH",
        ):
            self.assertIn(f"`{env}`", self.text, env)

    def test_designer_catalog_and_swarmspec(self):
        self.assertIn("## Designer", self.text)
        self.assertIn("SwarmSpec", self.text)
        self.assertIn("design_prompt", self.text)
        self.assertIn("parse_swarm_spec", self.text)
        self.assertIn("validate_spec", self.text)
        for form in (
            "solo", "panel", "council", "debate", "vote", "swarm",
            "hierarchy", "metaloop", "moa", "heavy", "discuss", "graph",
            "ladder", "speclock", "breaker", "ballot", "factory", "diamond",
            "nested-hive", "ultraswarm", "ureview", "custom",
        ):
            self.assertIn(form, self.text, form)

    def test_hive_runner_and_prompts(self):
        self.assertIn("## Hive runner", self.text)
        self.assertIn("python/fusion_swarm/hive.py", self.text)
        self.assertIn("dry_run", self.text)
        self.assertIn("pattern=hive", self.text)
        self.assertIn("## Prompts", self.text)
        self.assertIn("architect_prompt", self.text)
        self.assertIn("captain_prompt", self.text)
        self.assertIn("worker_prompt", self.text)
        self.assertIn("NEVER", self.text)
        self.assertIn(
            'python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"',
            self.text,
        )

    def test_cli_section(self):
        self.assertIn("## CLI", self.text)
        self.assertIn("python -m fusion_swarm.board --db PATH", self.text)
        for cmd in (
            "init", "register", "post", "dm", "reply", "poll", "mentions",
            "agents", "tree", "heartbeat", "join", "channels", "ack",
        ):
            self.assertIn(f"`{cmd}`", self.text, cmd)
        self.assertIn("Always print JSON", self.text)

    def test_honesty_rules(self):
        self.assertIn("## Honesty rules", self.text)
        self.assertIn("Real dispatch only", self.text)
        self.assertIn("Absent ≠ agreement", self.text)
        self.assertIn("Stdlib-only Python", self.text)
        self.assertIn("Fail-closed validation", self.text)
        self.assertIn("unittest", self.lower)
        self.assertIn("no live paid", self.lower)
        self.assertIn("Untrusted child text", self.text)

    def test_four_captain_example_in_hive_doc(self):
        self.assertIn("## Example — 4 captains, 8 children", self.text)
        self.assertIn("muse-spark-1.3", self.text)
        self.assertIn("glm-5.3", self.text)
        self.assertIn("4 captains + 8 children", self.text)
        self.assertIn("children are andrewcode even when", self.text)

    def test_architect_latitude_section(self):
        self.assertIn("### Architect latitude", self.text)
        self.assertIn("Hard constraints", self.text)
        self.assertIn("Everything else is the architect's call", self.text)


class TestSliceDoesNotStub(unittest.TestCase):
    def test_hive_md_is_substantial(self):
        self.assertGreater(os.path.getsize(HIVE), 8000)

    def test_readme_still_longer_than_before_hive_insert(self):
        # Original README was 368 lines / ~18k; with Hive it must grow, not shrink.
        text = _read(README)
        self.assertGreater(len(text), 20000)
        self.assertGreater(text.count("\n"), 400)


if __name__ == "__main__":
    unittest.main()
