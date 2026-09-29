"""Offline contract tests for skills/fusion-designer/SKILL.md (slice J).

No CLIs, no network, no paid dispatch. The skill is the product; these tests
lock the host procedure, the catalog table, and the SwarmSpec handoff so a
future edit cannot silently collapse a nested coding swarm into a panel.

Run from the plugin root:
    python -m unittest tests.test_fusion_designer_skill
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "fusion-designer" / "SKILL.md"

# Shared Topology catalog — must match the designer.py / hive contract exactly.
CATALOG_FORMS = (
    "solo",
    "panel",
    "council",
    "debate",
    "vote",
    "swarm",
    "hierarchy",
    "metaloop",
    "moa",
    "heavy",
    "discuss",
    "graph",
    "ladder",
    "speclock",
    "breaker",
    "ballot",
    "factory",
    "diamond",
    "nested-hive",
    "ultraswarm",
    "ureview",
    "custom",
)

SWARM_SPEC_FIELDS = (
    "name",
    "architect",
    "operator",
    "captains",
    "cross_talk",
    "board",
    "max_depth",
    "max_children_per_agent",
    "max_agents",
    "budget",
    "communication",
    "task",
    "notes",
)

CAPTAIN_FIELDS = ("id", "provider", "model", "spawn", "spawn_via")

COMMUNICATION_VALUES = ("open", "lineage", "need-to-know")

TOPOLOGY_COLUMNS = (
    "when",
    "mechanic",
    "communication",
    "nesting",
    "default_captains",
    "default_children",
    "cost_shape",
)


def _frontmatter(text: str) -> dict:
    m = re.match(r"^---\s*\n(?P<body>.*?)\n---\s*\n", text, re.DOTALL)
    if not m:
        return {}
    out: dict = {}
    key = None
    for line in m.group("body").splitlines():
        fm = re.match(r"^(?P<key>[a-zA-Z0-9_-]+):\s*(?P<value>.*)$", line)
        if fm:
            key = fm.group("key")
            val = fm.group("value").strip()
            if val == ">|" or val == ">":
                out[key] = ""
            else:
                out[key] = val
        elif key and (line.startswith("  ") or line.startswith("\t")):
            out[key] = (out.get(key, "") + " " + line.strip()).strip()
    return out


class DesignerSkillExists(unittest.TestCase):
    def test_skill_file_is_the_only_slice_target(self):
        self.assertTrue(SKILL.is_file(), f"missing {SKILL}")
        self.assertGreater(SKILL.stat().st_size, 2000)


class DesignerSkillFrontmatter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.fm = _frontmatter(cls.text)

    def test_yaml_name_is_fusion_designer(self):
        self.assertEqual(self.fm.get("name"), "fusion-designer")

    def test_description_names_architects_and_swarmspec(self):
        desc = (self.fm.get("description") or "").lower()
        self.assertIn("fable", desc)
        self.assertTrue("astra" in desc or "gpt-6-astra" in desc)
        self.assertIn("swarmspec", desc.replace(" ", "").lower() or desc)
        # folded YAML may keep SwarmSpec capitalization
        self.assertRegex(self.fm.get("description") or "", r"SwarmSpec")

    def test_triggers_cover_design_and_nested_hive(self):
        desc = (self.fm.get("description") or "").lower()
        for needle in ("design the swarm", "nested hive", "custom topology"):
            self.assertIn(needle, desc, needle)


class DesignerSkillHostProcedure(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        cls.lower = cls.text.lower()

    def test_pinned_models_are_hard_constraints(self):
        self.assertIn("HARD CONSTRAINTS", self.text)
        self.assertRegex(
            self.text,
            r"(?i)pinned models? and providers? are HARD CONSTRAINTS",
        )
        self.assertRegex(self.lower, r"may \*\*not\*\* swap|must not swap")

    def test_user_pins_are_locked_table(self):
        self.assertIn("Every provider/model the user named", self.text)
        self.assertIn("Live roster", self.text)

    def test_top_tier_architect_must_design(self):
        self.assertIn("Fable 5.1", self.text)
        self.assertIn("gpt-6-astra", self.text)
        self.assertIn("Astra", self.text)
        self.assertRegex(self.text, r"MUST design")
        self.assertIn("You do **not** invent the swarm shape", self.text)

    def test_design_prompt_cli(self):
        self.assertIn('python -m fusion_swarm designer "<task>"', self.text)
        self.assertIn("swarm.sh", self.text)
        self.assertRegex(self.text, r"swarm\.sh\"?\s+designer")

    def test_dispatch_fable_or_astra_codex(self):
        self.assertIn("fusion.sh\" dispatch fable", self.text)
        self.assertIn("fusion.sh\" dispatch codex", self.text)
        self.assertIn("gpt-6-astra", self.text)
        self.assertIn("fable-5.1", self.text)

    def test_parse_validate_then_hive(self):
        self.assertIn("parse_swarm_spec", self.text)
        self.assertIn("validate_spec", self.text)
        self.assertIn('python -m fusion_swarm hive', self.text)
        self.assertIn("--spec-file", self.text)

    def test_never_silently_pick_panel_for_nested_coding_swarm(self):
        self.assertIn("Never silently pick `panel`", self.text)
        self.assertIn("large nested coding swarm", self.lower)
        self.assertIn("do not execute it", self.lower)
        # host must reject a panel spec for nested coding work
        self.assertRegex(
            self.text,
            r"(?i)reject the spec|failed design|do not execute",
        )

    def test_forbids_host_authored_spec_on_absent_architect(self):
        self.assertIn("Absent ≠ agreement", self.text)
        self.assertIn("not a license to host-author a swarmspec", self.lower)
        self.assertIn("Real dispatch only", self.text)

    def test_no_discovery_hunt(self):
        self.assertIn("NO DISCOVERY", self.text)
        self.assertIn("find ~", self.text)
        self.assertIn("FUSION_PLUGIN_ROOT", self.text)

    def test_cost_banner_before_paid_call(self):
        self.assertIn("mode=designer", self.text)
        self.assertIn("Proceeding…", self.text)

    def test_children_are_andrewcode_processes(self):
        self.assertIn("Children are always AndrewCode processes", self.text)
        self.assertIn("spawn_via", self.text)
        self.assertIn("andrewcode", self.lower)

    def test_spawn_limits_defaults(self):
        self.assertIn("max_depth=2", self.text)
        self.assertIn("max_children_per_agent=4", self.text)
        self.assertIn("max_agents=24", self.text)

    def test_hive_board_channels(self):
        for ch in ("hive", "architect", "captains", "workers", "system"):
            self.assertIn(f"`{ch}`", self.text, ch)
        self.assertIn("lineage-<captain>", self.text)
        self.assertIn("task-main", self.text)
        self.assertIn("python -m fusion_swarm.board", self.text)

    def test_communication_enum(self):
        for val in COMMUNICATION_VALUES:
            self.assertIn(f"`{val}`", self.text, val)

    def test_offline_honesty_windows(self):
        self.assertIn("Git Bash", self.text)
        self.assertIn("stdlib-only", self.lower)
        self.assertIn("offline", self.lower)


class DesignerSkillSwarmSpecShape(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")

    def test_example_json_has_every_swarmspec_field(self):
        # The fenced JSON example must name every contract field so the host
        # cannot emit a half-spec.
        for field in SWARM_SPEC_FIELDS:
            self.assertRegex(
                self.text,
                rf'"{field}"\s*:',
                f"SwarmSpec example missing {field!r}",
            )

    def test_captain_object_fields(self):
        for field in CAPTAIN_FIELDS:
            self.assertRegex(
                self.text,
                rf'"{field}"\s*:',
                f"captain example missing {field!r}",
            )

    def test_captain_spawn_via_literals(self):
        self.assertIn("`andrewcode`", self.text)
        self.assertIn("`adapter`", self.text)


class DesignerSkillCatalog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.text = SKILL.read_text(encoding="utf-8")
        # Isolate the catalog table so a later mention of `panel` in prose
        # does not count as a catalog row.
        m = re.search(
            r"## Catalog of named forms\n(?P<body>.*?)(\n## |\Z)",
            cls.text,
            re.DOTALL,
        )
        cls.catalog = m.group("body") if m else ""
        cls.rows = re.findall(r"^\|\s*`([a-z0-9-]+)`\s*\|", cls.catalog, re.M)

    def test_catalog_section_exists(self):
        self.assertTrue(self.catalog, "missing ## Catalog of named forms")

    def test_catalog_table_has_topology_columns(self):
        header = self.catalog.splitlines()[2] if self.catalog else ""
        # first non-blank after the intro is the markdown header row
        header_line = next(
            (ln for ln in self.catalog.splitlines() if ln.startswith("| name")),
            "",
        )
        self.assertTrue(header_line, header)
        for col in TOPOLOGY_COLUMNS:
            self.assertIn(col, header_line, col)

    def test_every_named_form_is_a_table_row(self):
        self.assertEqual(list(CATALOG_FORMS), self.rows)

    def test_catalog_includes_custom_and_nested_hive(self):
        self.assertIn("nested-hive", self.rows)
        self.assertIn("custom", self.rows)
        self.assertIn("ultraswarm", self.rows)

    def test_nested_hive_is_board_nested(self):
        hive_row = next(ln for ln in self.catalog.splitlines() if "`nested-hive`" in ln)
        self.assertIn("board", hive_row)
        self.assertIn("yes", hive_row)

    def test_panel_row_does_not_claim_nesting(self):
        panel_row = next(ln for ln in self.catalog.splitlines() if ln.startswith("| `panel`"))
        cells = [c.strip() for c in panel_row.strip("|").split("|")]
        # name, when, mechanic, communication, nesting, ...
        self.assertEqual(cells[0], "`panel`")
        self.assertEqual(cells[4], "no")

    def test_routing_hint_keeps_nested_coding_off_panel(self):
        self.assertIn("large nested coding swarm", self.catalog.lower() + self.text.lower())
        self.assertIn("Do not collapse the first class into the second", self.text)


class DesignerSkillDoesNotStub(unittest.TestCase):
    def test_no_placeholder_todos(self):
        text = SKILL.read_text(encoding="utf-8")
        for needle in ("TODO", "FIXME", "TBD", "... rest", "coming soon"):
            self.assertNotIn(needle, text, needle)


if __name__ == "__main__":
    unittest.main()
