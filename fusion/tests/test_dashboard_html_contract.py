"""t5 — static contract for the self-contained dashboard HTML.

Guards the invariants that can be checked without a browser: single file, zero
external assets, exactly three tabs, no fourth tab, token placeholder present,
controls come from /api/schema (not hardcoded), and no provider model inventory
or enum vocabulary is baked into the HTML (those come from discovery + schema).
"""
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HTML = (ROOT / "scripts" / "dashboard_static.html").read_text(encoding="utf-8")


class HtmlContract(unittest.TestCase):
    def test_no_external_assets(self):
        # no CDN/script/style/link/img/font fetches of any kind
        for pat in (r'src\s*=\s*["\']https?:', r'href\s*=\s*["\']https?:',
                    r'@import', r'url\(\s*https?:', r'<link\b'):
            self.assertFalse(re.search(pat, HTML, re.I), f"external asset: {pat}")

    def test_exactly_three_tabs(self):
        tabs = re.findall(r'data-tab="([a-z]+)"', HTML)
        self.assertEqual(sorted(tabs), ["config", "modes", "providers"])

    def test_token_placeholder_present(self):
        self.assertIn("__FUSION_TOKEN__", HTML)

    def test_uses_schema_and_discovery_endpoints(self):
        for ep in ("/api/schema", "/api/discovery", "/api/discovery/refresh",
                   "/api/modes/resolved", "/api/config", "/api/providers"):
            self.assertIn(ep, HTML, ep)

    def test_no_hardcoded_model_inventory(self):
        # real ecosystem model ids must never be literals in the HTML.
        for m in ("gpt-5.6-sol", "glm-5.2", "grok-4.5", "gemini-3.5-flash",
                  "opencode-go/", "meta/muse", "claude-fable"):
            self.assertNotIn(m, HTML, f"hardcoded model id {m!r} in HTML")

    def test_no_hardcoded_enum_vocab(self):
        # sandbox/effort/policy vocab lives in the Python schema, not the HTML.
        for v in ("workspace-write", "danger-full-access", "on-demand", "xhigh"):
            self.assertNotIn(v, HTML, f"hardcoded enum value {v!r} in HTML")

    def test_has_custom_escape_hatch_and_unverified_badge(self):
        self.assertIn("Custom…", HTML)
        self.assertIn("badge custom", HTML)

    def test_theme_and_motion_support(self):
        self.assertIn("prefers-color-scheme", HTML)
        self.assertIn("prefers-reduced-motion", HTML)
        self.assertIn('data-theme="dark"', HTML)
        self.assertIn('data-theme="light"', HTML)

    def test_no_inline_stack_trace_or_token_leak_markers(self):
        self.assertNotIn("SESSION_TOKEN", HTML)  # server-only symbol

    def test_file_is_clean_utf8_no_control_bytes(self):
        raw = (ROOT / "scripts" / "dashboard_static.html").read_bytes()
        self.assertEqual(raw.count(b"\x00"), 0, "NUL byte in HTML")
        raw.decode("utf-8")  # raises if not valid UTF-8


if __name__ == "__main__":
    unittest.main()
