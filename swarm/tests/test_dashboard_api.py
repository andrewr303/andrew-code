"""t4 — dashboard HTTP endpoints: schema, cache-only discovery, secure refresh,
schema-revalidated config writes, resolved rosters.

Runs a REAL ThreadingHTTPServer on 127.0.0.1:0 and drives it over HTTP so the
token/Origin gate is exercised as shipped. Config writes are isolated to a
temp copy of defaults.env so the repo file is never mutated.
"""
import json
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "python"))
sys.path.insert(0, str(ROOT / "scripts"))

import dashboard_server as srv  # noqa: E402
from fusion_swarm import config_store  # noqa: E402


def _req(method, url, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(r) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


class DashboardAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), srv.Handler)
        cls.port = cls.httpd.server_address[1]
        cls.base = f"http://127.0.0.1:{cls.port}"
        cls.origin = cls.base
        cls.token = srv.SESSION_TOKEN
        cls.t = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.t.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    # -- GET structure -------------------------------------------------------
    def test_get_schema(self):
        st, body = _req("GET", self.base + "/api/schema")
        self.assertEqual(st, 200)
        self.assertEqual(len(body["schema"]), len(body["values"]))
        self.assertTrue(all("widget" in d for d in body["schema"]))

    def test_get_discovery_is_cache_only(self):
        # patch the probe to blow up; a cache-only GET must not call it.
        import fusion_swarm.discovery as d
        real = d._run_probe
        d._run_probe = lambda argv: (_ for _ in ()).throw(AssertionError("probed"))
        try:
            st, body = _req("GET", self.base + "/api/discovery")
        finally:
            d._run_probe = real
        self.assertEqual(st, 200)
        self.assertIn("opencode", body)

    def _isolated_cache(self):
        # point discovery's cache at a throwaway file so these tests never
        # pollute the user's real ~/.fusion/model-cache.json.
        import fusion_swarm.discovery as d
        tmp = Path(tempfile.mkdtemp()) / "cache.json"
        return d, d.CACHE_FILE, tmp

    def test_discovery_failure_flags_curated_not_selectable(self):
        # a provider whose binary is missing must return is_curated=True so the
        # frontend never presents curated fallbacks as live/selectable models.
        d, real_cache, tmp = self._isolated_cache()
        real_which = d.shutil.which
        d.CACHE_FILE, d.shutil.which = tmp, (lambda b: None)
        try:
            res = d.discover("codex", force=True)
        finally:
            d.CACHE_FILE, d.shutil.which = real_cache, real_which
            shutil.rmtree(tmp.parent, ignore_errors=True)
        self.assertEqual(res["status"], "missing")
        self.assertTrue(res["is_curated"], "curated fallback not flagged is_curated")

    def test_live_discovery_is_not_flagged_curated(self):
        d, real_cache, tmp = self._isolated_cache()
        real_which, real_probe = d.shutil.which, d._run_probe
        d.CACHE_FILE = tmp
        d.shutil.which = lambda b: "/fake/" + b
        d._run_probe = lambda argv: (0, '{"data":[{"id":"grok-9.9"}]}')
        try:
            res = d.discover("grok", force=True)
        finally:
            d.CACHE_FILE, d.shutil.which, d._run_probe = real_cache, real_which, real_probe
            shutil.rmtree(tmp.parent, ignore_errors=True)
        self.assertEqual(res["status"], "live")
        self.assertFalse(res["is_curated"])
        self.assertIn("grok-9.9", res["models"])

    def test_get_modes_resolved(self):
        st, body = _req("GET", self.base + "/api/modes/resolved")
        self.assertEqual(st, 200)
        moa = [m for m in body["modes"] if m["mode"] == "moa"][0]
        self.assertEqual(moa["resolution"], "engine")
        self.assertTrue(moa["overridable"])

    # -- security gate on writes --------------------------------------------
    def test_config_post_needs_token(self):
        st, body = _req("POST", self.base + "/api/config",
                        {"key": "FUSION_CODEX_TIMEOUT", "value": "900"},
                        {"Origin": self.origin})
        self.assertEqual(st, 403)

    def test_config_post_rejects_foreign_origin(self):
        st, body = _req("POST", self.base + "/api/config",
                        {"key": "FUSION_CODEX_TIMEOUT", "value": "900"},
                        {"X-Fusion-Token": self.token, "Origin": "http://evil.example"})
        self.assertEqual(st, 403)

    def test_refresh_post_needs_token(self):
        st, body = _req("POST", self.base + "/api/discovery/refresh",
                        {"provider": "codex"}, {"Origin": self.origin})
        self.assertEqual(st, 403)  # rejected before any probe

    # -- schema revalidation -------------------------------------------------
    def test_config_rejects_unknown_key(self):
        st, body = _req("POST", self.base + "/api/config",
                        {"key": "FUSION_NOT_REAL", "value": "x"},
                        {"X-Fusion-Token": self.token, "Origin": self.origin})
        self.assertEqual(st, 400)

    def test_config_rejects_bad_int(self):
        st, body = _req("POST", self.base + "/api/config",
                        {"key": "FUSION_CODEX_TIMEOUT", "value": "notint"},
                        {"X-Fusion-Token": self.token, "Origin": self.origin})
        self.assertEqual(st, 400)

    def test_refresh_rejects_unknown_provider(self):
        st, body = _req("POST", self.base + "/api/discovery/refresh",
                        {"provider": "bogus"},
                        {"X-Fusion-Token": self.token, "Origin": self.origin})
        self.assertEqual(st, 400)

    # -- successful write, isolated to a temp defaults.env -------------------
    def test_config_write_succeeds_isolated(self):
        tmp = Path(tempfile.mkdtemp())
        env = tmp / "defaults.env"
        shutil.copy(config_store.DEFAULTS_ENV, env)
        real_env, real_bak = config_store.DEFAULTS_ENV, config_store.BACKUP_DIR
        config_store.DEFAULTS_ENV = env
        config_store.BACKUP_DIR = tmp / ".backups"
        try:
            st, body = _req("POST", self.base + "/api/config",
                            {"key": "FUSION_MOA_OPENCODE_MODEL", "value": "meta/muse-1.1"},
                            {"X-Fusion-Token": self.token, "Origin": self.origin})
            self.assertEqual(st, 200, body)
            self.assertTrue(body["ok"])
            # model widgets carry no schema inventory (options come from live
            # discovery), so the server can't flag custom — the frontend does
            # that against the discovery list. Enum-custom IS server-flagged.
            self.assertFalse(body["custom"])
            # the write actually uncommented+set the line
            parsed = config_store.parse_defaults()
            self.assertFalse(parsed["FUSION_MOA_OPENCODE_MODEL"]["commented"])
            self.assertEqual(parsed["FUSION_MOA_OPENCODE_MODEL"]["value"], "meta/muse-1.1")
        finally:
            config_store.DEFAULTS_ENV, config_store.BACKUP_DIR = real_env, real_bak
            shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
