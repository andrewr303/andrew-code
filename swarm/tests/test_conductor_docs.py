"""Slice L — conductor docs pin hive + designer as first-class modes.

Offline unittest. Reads the fusion-orchestrate skill and collaboration-modes
reference; never dispatches a live CLI.

Run from the plugin root:
  python -m unittest tests.test_conductor_docs
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_SKILL = _ROOT / "skills" / "fusion-orchestrate" / "SKILL.md"
_MODES = (
    _ROOT / "skills" / "fusion-orchestrate" / "references" / "collaboration-modes.md"
)

# Core + already-documented advanced modes that must survive the hive/designer add.
_EXISTING_MODES = (
    "solo",
    "panel",
    "council",
    "debate",
    "vote",
    "swarm",
    "hierarchy",
    "ultraswarm",
    "graph",
    "ureview",
)

_CATALOG_FORMS = (
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

_DEFAULT_CHANNELS = ("hive", "architect", "captains", "workers", "system")


def _table_modes(text: str) -> list[str]:
    """Mode tokens from the markdown mode table (`| `solo` | ...`)."""
    found = []
    in_table = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("| Mode |"):
            in_table = True
            continue
        if in_table:
            if not line.startswith("|"):
                break
            m = re.match(r"\|\s*`([a-z-]+)`\s*\|", line)
            if m:
                found.append(m.group(1))
    return found


def _heading_modes(text: str) -> list[str]:
    """Mode tokens from `## N. `mode`` headings in collaboration-modes.md."""
    return re.findall(r"^##\s+\d+\.\s+`([a-z-]+)`", text, re.MULTILINE)


class ConductorDocsHiveDesigner(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.skill = _SKILL.read_text(encoding="utf-8")
        cls.modes = _MODES.read_text(encoding="utf-8")

    def test_files_exist(self):
        self.assertTrue(_SKILL.is_file(), _SKILL)
        self.assertTrue(_MODES.is_file(), _MODES)

    def test_skill_mode_table_keeps_existing_and_adds_hive_designer(self):
        table = _table_modes(self.skill)
        for name in _EXISTING_MODES:
            self.assertIn(name, table, f"mode table lost {name}")
        self.assertIn("hive", table)
        self.assertIn("designer", table)
        # hive and designer are first-class rows, not a footnote-only mention
        self.assertGreater(table.index("hive"), table.index("ureview"))
        self.assertGreater(table.index("designer"), table.index("hive"))

    def test_collaboration_modes_headings_keep_existing_and_add_hive_designer(self):
        headings = _heading_modes(self.modes)
        for name in ("solo", "panel", "council", "debate", "vote", "swarm",
                     "ultraswarm", "graph", "ureview"):
            self.assertIn(name, headings, f"heading lost {name}")
        self.assertIn("hive", headings)
        self.assertIn("designer", headings)
        self.assertEqual(headings[-2:], ["hive", "designer"])

    def test_hive_is_nested_andrewcode_plus_board(self):
        blob = self.skill + "\n" + self.modes
        self.assertIn("Hive Board", blob)
        self.assertIn("andrewcode", blob)
        self.assertIn("nested", blob.lower())
        self.assertIn("python -m fusion_swarm.board", blob)
        self.assertIn("python -m fusion_swarm.hive", blob)
        self.assertIn("--auto", blob)
        self.assertIn("--yolo", blob)
        self.assertIn("--output-format text", blob)
        self.assertIn("FUSION_BOARD", blob)
        self.assertIn("FUSION_AGENT_ID", blob)
        for ch in _DEFAULT_CHANNELS:
            self.assertIn(f"`{ch}`", blob, f"missing default channel {ch}")
        self.assertIn("lineage-", blob)
        self.assertIn("task-main", blob)
        self.assertIn("never talk to the human", blob.lower())

    def test_designer_is_architect_invents_topology(self):
        blob = self.skill + "\n" + self.modes
        self.assertIn("design_prompt", blob)
        self.assertIn("SwarmSpec", blob)
        self.assertIn("parse_swarm_spec", blob)
        self.assertIn("validate_spec", blob)
        self.assertIn("fail-closed", blob)
        self.assertIn("gpt-6-astra", blob)
        self.assertIn("fable", blob.lower())
        self.assertIn("hard constraints", blob)
        for form in _CATALOG_FORMS:
            self.assertIn(form, blob, f"catalog missing {form}")

    def test_large_coding_swarm_default_is_designer_then_hive_then_board(self):
        blob = self.skill + "\n" + self.modes
        self.assertRegex(
            blob,
            re.compile(
                r"large coding swarm.+(design|designs).+hive.+(execute|executes).+board",
                re.IGNORECASE | re.DOTALL,
            ),
        )
        # Both files must state the default, not just one of them.
        for text, path in ((self.skill, _SKILL), (self.modes, _MODES)):
            self.assertIn("large coding swarm", text.lower(), path)
            self.assertIn("hive", text)
            self.assertIn("designer", text)
            self.assertIn("board", text.lower())

    def test_honesty_rules_still_present(self):
        blob = self.skill + "\n" + self.modes
        self.assertIn("Absent ≠ agreement", blob)
        self.assertIn("real dispatch", blob.lower())
        self.assertIn("dry_run", blob)

    def test_existing_mode_mechanics_not_rewritten_away(self):
        # Minimal-edit guard: canonical six still have their when/mechanic/cost.
        for name in ("solo", "panel", "council", "debate", "vote", "swarm"):
            self.assertIn(f"`{name}`", self.modes)
            self.assertIn("**When:**", self.modes)
            self.assertIn("**Mechanic:**", self.modes)
            self.assertIn("**Cost:**", self.modes)
        self.assertIn("fusion.sh panel", self.modes)
        self.assertIn("anti-conformity.md", self.modes)

    def test_hive_and_designer_have_when_mechanic_cost(self):
        for name in ("hive", "designer"):
            block = re.search(
                rf"##\s+\d+\.\s+`{name}`.*?(?=\n## |\Z)",
                self.modes,
                re.DOTALL,
            )
            self.assertIsNotNone(block, f"missing {name} section")
            body = block.group(0)
            self.assertIn("**When:**", body)
            self.assertIn("**Mechanic:**", body)
            self.assertIn("**Cost:**", body)


if __name__ == "__main__":
    unittest.main()
