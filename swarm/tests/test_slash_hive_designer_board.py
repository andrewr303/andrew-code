"""Offline contract tests for Slice M slash commands.

Locks commands/hive.md, commands/designer.md, and commands/board.md to the
same frontmatter style as metaloop.md / swarm.md, and to the hive / designer /
board engine verbs (swarm.sh + fusion.sh + python -m fusion_swarm.board).

No live CLIs, no network, no paid calls.

Run from the plugin root:
  python -m unittest tests.test_slash_hive_designer_board
"""
from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMMANDS = ROOT / "commands"
sys.path.insert(0, str(ROOT / "python"))

_FRONTMATTER_RE = re.compile(r"^---\s*\n(?P<body>.*?)\n---\s*\n", re.DOTALL)
_FIELD_RE = re.compile(r"^(?P<key>[a-zA-Z_-]+):\s*(?P<value>.*)$")

# Catalog forms the designer command must name (shared SwarmSpec contract).
DESIGNER_CATALOG = (
    "solo", "panel", "council", "debate", "vote", "swarm", "hierarchy",
    "metaloop", "moa", "heavy", "discuss", "graph", "ladder", "speclock",
    "breaker", "ballot", "factory", "diamond", "nested-hive", "ultraswarm",
    "ureview", "custom",
)

# Board CLI verbs from python/fusion_swarm/board.py main().
BOARD_VERBS = (
    "init", "register", "post", "dm", "reply", "poll", "mentions",
    "agents", "tree", "heartbeat", "join", "channels", "ack",
)

# Default Hive Board rooms created on init.
DEFAULT_CHANNELS = ("hive", "architect", "captains", "workers", "system")

# SwarmSpec fields the designer command must document.
SWARM_SPEC_FIELDS = (
    "name", "architect", "operator", "captains", "cross_talk", "board",
    "max_depth", "max_children_per_agent", "max_agents", "budget",
    "communication", "task", "notes",
)

# Hive result-dict keys from fusion_swarm.hive.run().
HIVE_RESULT_KEYS = (
    "pattern=hive", "run_id", "board_path", "spec", "agents", "tree",
    "posts_seeded", "dry_run",
)


def _read(name: str) -> str:
    path = COMMANDS / name
    return path.read_text(encoding="utf-8")


def _frontmatter(text: str) -> dict:
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}
    out = {}
    for line in m.group("body").splitlines():
        fm = _FIELD_RE.match(line)
        if fm:
            out[fm.group("key")] = fm.group("value").strip()
    return out


def _body(text: str) -> str:
    return _FRONTMATTER_RE.sub("", text, count=1)


class _CommandFileMixin:
    filename: str
    skill: str
    description_needles: tuple[str, ...] = ()

    @property
    def text(self) -> str:
        return _read(self.filename)

    @property
    def fm(self) -> dict:
        return _frontmatter(self.text)

    @property
    def body(self) -> str:
        return _body(self.text)

    def test_file_exists(self):
        self.assertTrue((COMMANDS / self.filename).is_file(), self.filename)

    def test_frontmatter_has_description_and_argument_hint(self):
        self.assertIn("description", self.fm, "missing description")
        self.assertTrue(self.fm["description"], "empty description")
        self.assertIn("argument-hint", self.fm, "missing argument-hint")
        self.assertTrue(self.fm["argument-hint"], "empty argument-hint")

    def test_description_mentions_purpose(self):
        desc = self.fm["description"].lower()
        for needle in self.description_needles:
            self.assertIn(needle.lower(), desc, f"description missing {needle!r}")

    def test_invokes_matching_skill(self):
        self.assertRegex(
            self.body,
            rf"Invoke the \*\*{re.escape(self.skill)}\*\* skill",
            f"must invoke **{self.skill}** skill like metaloop.md / swarm.md",
        )

    def test_direct_execution_no_home_search(self):
        self.assertRegex(self.body, r"CRITICAL\s+.*DIRECT EXECUTION")
        self.assertRegex(self.body, r"find ~")
        self.assertRegex(self.body, r"NEVER begin with location searches|NEVER begin")

    def test_honesty_rules(self):
        blob = self.text.lower()
        self.assertRegex(self.text, re.compile(r"absent\s*.*\s*agreement", re.I))
        self.assertIn("stdlib", blob)
        self.assertTrue(
            "real dispatch" in blob or "real board" in blob,
            "must require real dispatch / real board I/O",
        )

    def test_no_simulation(self):
        blob = self.body.lower()
        self.assertTrue(
            "never simulated" in blob
            or "must not call live models" in blob
            or "do not invent" in blob,
            "must forbid simulated / invented panel output",
        )

    def test_windows_git_bash_relative_paths(self):
        self.assertRegex(
            self.body,
            re.compile(r"Windows\+Git Bash|Windows/OneDrive|Git Bash", re.I),
        )
        # Forbidden discovery commands are named so the host will not run them.
        self.assertIn("find ~/.codex", self.body)
        self.assertIn("NEVER begin", self.body)

    def test_honors_arguments(self):
        self.assertIn("$ARGUMENTS", self.body)

    def test_utf8_no_nul(self):
        raw = (COMMANDS / self.filename).read_bytes()
        self.assertEqual(raw.count(b"\x00"), 0)
        raw.decode("utf-8")


class TestHiveCommand(_CommandFileMixin, unittest.TestCase):
    filename = "hive.md"
    skill = "fusion-hive"
    description_needles = ("hive", "nested", "board", "architect")

    def test_points_at_swarm_sh_hive_verb(self):
        self.assertIn("scripts/swarm.sh hive", self.body)
        self.assertIn("python -m fusion_swarm hive", self.body)
        self.assertIn("--dry-run", self.body)
        self.assertIn("--json", self.body)

    def test_fusion_sh_detect_and_dispatch(self):
        self.assertIn("fusion.sh detect", self.body)
        self.assertIn("fusion.sh dispatch", self.body)

    def test_nested_andrewcode_workers(self):
        blob = self.body.lower()
        self.assertIn("andrewcode", blob)
        self.assertIn("--auto", self.body)
        self.assertIn("--output-format text", self.body)
        self.assertRegex(self.body, r"--yolo|-y")
        self.assertIn("nested", blob)

    def test_default_channels_and_lineage(self):
        for ch in DEFAULT_CHANNELS:
            self.assertIn(ch, self.body, f"missing default channel {ch}")
        self.assertIn("lineage-", self.body)
        self.assertIn("task-main", self.body)

    def test_result_dict_contract(self):
        for key in HIVE_RESULT_KEYS:
            self.assertIn(key, self.body, f"hive result missing {key}")

    def test_spawn_limits(self):
        self.assertIn("max_depth=2", self.body)
        self.assertIn("max_children_per_agent=4", self.body)
        self.assertIn("max_agents=24", self.body)

    def test_cross_talk_and_human_boundary(self):
        blob = self.body.lower()
        self.assertIn("cross_talk", blob)
        self.assertRegex(self.body, r"NEVER talk to the human")
        self.assertIn("/fusion:board", self.body)
        self.assertIn("/fusion:designer", self.body)

    def test_argument_hint_has_dry_run_and_architect(self):
        hint = self.fm["argument-hint"]
        self.assertIn("--dry-run", hint)
        self.assertIn("--architect", hint)
        self.assertIn("--spec-file", hint)

    def test_captains_can_be_any_live_cli(self):
        blob = self.body.lower()
        for prov in ("codex", "opencode", "grok", "copilot", "kimi", "andrewcode"):
            self.assertIn(prov, blob, f"captain provider {prov} not named")


class TestDesignerCommand(_CommandFileMixin, unittest.TestCase):
    filename = "designer.md"
    skill = "fusion-designer"
    description_needles = ("designer", "swarmspec", "fable")

    def test_points_at_swarm_sh_designer_verb(self):
        self.assertIn("scripts/swarm.sh designer", self.body)
        self.assertIn("--packet", self.body)
        self.assertIn("--json", self.body)

    def test_fusion_sh_live_architect_dispatch(self):
        self.assertIn("fusion.sh detect", self.body)
        self.assertIn("fusion.sh dispatch fable", self.body)
        self.assertIn("fusion.sh dispatch codex", self.body)
        self.assertIn("gpt-6-astra", self.body)

    def test_catalog_forms(self):
        blob = self.body.lower()
        for form in DESIGNER_CATALOG:
            self.assertIn(form, blob, f"catalog form {form} not named")

    def test_topology_fields(self):
        for field in (
            "name", "when", "mechanic", "communication", "nesting",
            "default_captains", "default_children", "cost_shape",
        ):
            self.assertIn(field, self.body, f"Topology field {field}")

    def test_swarm_spec_fields(self):
        for field in SWARM_SPEC_FIELDS:
            self.assertIn(field, self.body, f"SwarmSpec field {field}")

    def test_fail_closed_parse_and_validate(self):
        self.assertIn("parse_swarm_spec", self.body)
        self.assertIn("validate_spec", self.body)
        self.assertIn("design_prompt", self.body)
        self.assertIn("fail-closed", self.body.lower())

    def test_packet_is_offline_path(self):
        self.assertIn("--packet", self.body)
        self.assertRegex(
            self.body,
            re.compile(r"must not.*call live models", re.I),
        )

    def test_hard_constraints_and_custom_latitude(self):
        blob = self.body.lower()
        self.assertIn("hard constraint", blob)
        self.assertIn("custom topology", blob)
        self.assertIn("only", blob)
        self.assertIn("swarmspec json", blob)

    def test_argument_hint_has_packet_and_architect(self):
        hint = self.fm["argument-hint"]
        self.assertIn("--packet", hint)
        self.assertIn("--architect", hint)
        self.assertIn("fable", hint)
        self.assertIn("astra", hint)

    def test_feeds_hive_spec_file(self):
        self.assertIn("/fusion:hive", self.body)
        self.assertIn("--spec-file", self.body)


class TestBoardCommand(_CommandFileMixin, unittest.TestCase):
    filename = "board.md"
    skill = "fusion-board"
    description_needles = ("hive board", "sqlite", "poll")

    def test_module_cli(self):
        self.assertIn("python -m fusion_swarm.board", self.body)
        self.assertIn("--db", self.body)
        self.assertIn("Always print JSON", self.body)

    def test_all_cli_verbs(self):
        hint = self.fm["argument-hint"]
        for verb in BOARD_VERBS:
            self.assertIn(verb, hint, f"argument-hint missing verb {verb}")
            self.assertIn(verb, self.body, f"body missing verb {verb}")

    def test_poll_howto_matches_hive_prompts(self):
        self.assertIn(
            'python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"',
            self.body,
        )
        self.assertIn(
            'python -m fusion_swarm.board --db "$FUSION_BOARD" post --from-agent "$FUSION_AGENT_ID"',
            self.body,
        )
        self.assertIn(
            'python -m fusion_swarm.board --db "$FUSION_BOARD" mentions --agent "$FUSION_AGENT_ID"',
            self.body,
        )

    def test_default_channels(self):
        for ch in DEFAULT_CHANNELS:
            self.assertIn(ch, self.body, f"missing default channel {ch}")

    def test_channel_kinds_and_dm_canonical(self):
        for kind in ("room", "dm", "thread", "lineage", "task"):
            self.assertIn(kind, self.body, f"kind {kind}")
        self.assertIn("dm:<sorted_a>:<sorted_b>", self.body)

    def test_jsonl_sidecar_and_wal(self):
        blob = self.body.lower()
        self.assertIn("wal", blob)
        self.assertIn("jsonl", blob)
        self.assertIn("<db>.jsonl", self.body)

    def test_fusion_sh_detect(self):
        self.assertIn("fusion.sh detect", self.body)
        self.assertIn("fusion.sh providers", self.body)

    def test_not_a_daemon_and_not_human_slack(self):
        blob = self.text.lower()
        self.assertTrue(
            "no daemon" in blob or "there is no daemon" in blob,
            "board must state there is no daemon",
        )
        self.assertIn("not a human slack", blob)
        self.assertRegex(self.body, r"NEVER talk to the human")

    def test_argument_hint_starts_with_db(self):
        hint = self.fm["argument-hint"]
        self.assertTrue(hint.startswith("--db PATH"))

    def test_empty_poll_is_not_agreement(self):
        self.assertRegex(self.body, r"empty poll is empty, not agreement")


class TestStyleParityWithMetaloopAndSwarm(unittest.TestCase):
    """The three new commands must share the metaloop/swarm command grammar."""

    def test_style_peers_exist(self):
        for name in ("metaloop.md", "swarm.md"):
            self.assertTrue((COMMANDS / name).is_file(), name)

    def test_same_frontmatter_keys_as_metaloop(self):
        metaloop = _frontmatter(_read("metaloop.md"))
        swarm = _frontmatter(_read("swarm.md"))
        for peer in (metaloop, swarm):
            self.assertIn("description", peer)
            self.assertIn("argument-hint", peer)
        for name in ("hive.md", "designer.md", "board.md"):
            fm = _frontmatter(_read(name))
            self.assertEqual(set(fm), {"description", "argument-hint"}, name)

    def test_metaloop_direct_execution_grammar_reused_by_hive(self):
        metaloop = _read("metaloop.md")
        hive = _read("hive.md")
        self.assertIn("CRITICAL — DIRECT EXECUTION", metaloop)
        self.assertIn("CRITICAL — DIRECT EXECUTION", hive)
        self.assertIn("bash scripts/swarm.sh", metaloop)
        self.assertIn("bash scripts/swarm.sh hive", hive)

    def test_swarm_invokes_skill_grammar(self):
        swarm = _read("swarm.md")
        self.assertIn("Invoke the **fusion-swarm** skill", swarm)
        self.assertIn("$ARGUMENTS", swarm)

    def test_modes_catalog_will_see_the_three_commands(self):
        # modes_catalog.all_modes() glob commands/*.md — the files must parse.
        from fusion_swarm import modes_catalog as mc

        modes = {m["mode"]: m for m in mc.all_modes()}
        for mode, skill in (
            ("hive", "fusion-hive"),
            ("designer", "fusion-designer"),
            ("board", "fusion-board"),
        ):
            self.assertIn(mode, modes, f"{mode}.md not picked up by modes_catalog")
            self.assertEqual(modes[mode]["invokes_skill"], skill)
            self.assertTrue(modes[mode]["description"])
            self.assertTrue(modes[mode]["argument_hint"])

    def test_hive_and_designer_detect_as_engine_patterns_only_if_wired(self):
        # Slice M is slash commands only. hive/designer may mention swarm.sh
        # verbs that are not yet in ENGINE_PATTERNS; that is honest — they
        # must not silently claim a roster the Python engine does not run.
        from fusion_swarm import modes_catalog as mc

        modes = {m["mode"]: m for m in mc.all_modes()}
        for mode in ("hive", "designer", "board"):
            pat = modes[mode]["engine_pattern"]
            if pat is not None:
                self.assertIn(pat, mc.ENGINE_PATTERN_PROVIDERS)


if __name__ == "__main__":
    unittest.main()
