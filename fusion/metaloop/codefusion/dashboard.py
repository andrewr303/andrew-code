"""Codefusion live board — Puppetmaster dashboard with product rebrand.

Falls back to a minimal stdlib board of Codefusion runs when PM is absent.
"""

from __future__ import annotations

import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

from codefusion.branding import DASHBOARD_SUBTITLE, DASHBOARD_TITLE, PRODUCT
from codefusion.paths import project_state_dir
from codefusion.pm_bridge import puppetmaster_available, start_dashboard as pm_start


def list_local_runs(limit: int = 50) -> list[dict[str, Any]]:
    root = project_state_dir() / "runs"
    if not root.is_dir():
        return []
    runs = []
    for d in sorted(root.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        result = d / "result.json"
        if not result.is_file():
            continue
        try:
            data = json.loads(result.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict):
            data["_dir"] = str(d)
            runs.append(data)
        if len(runs) >= limit:
            break
    return runs


def _html_index(runs: list[dict[str, Any]]) -> str:
    rows = []
    for r in runs:
        rid = r.get("run_id", "?")
        mode = r.get("mode", "?")
        ok = r.get("ok")
        elapsed = r.get("elapsed_s", "")
        rows.append(
            f"<tr><td><a href='/run/{rid}'>{rid}</a></td>"
            f"<td>{mode}</td><td>{'yes' if ok else 'no'}</td>"
            f"<td>{elapsed}</td></tr>"
        )
    body = "\n".join(rows) or "<tr><td colspan=4>No runs yet. Try <code>codefusion run \"…\"</code></td></tr>"
    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>{DASHBOARD_TITLE}</title>
<style>
  :root {{ color-scheme: dark; --bg:#0b1020; --card:#121a2f; --fg:#e8eefc; --muted:#8b9bb8; --accent:#7c5cff; --ok:#3dd68c; }}
  body {{ margin:0; font:14px/1.45 ui-sans-serif,system-ui,Segoe UI,sans-serif; background:var(--bg); color:var(--fg); }}
  header {{ padding:20px 28px; border-bottom:1px solid #1e2a44; }}
  h1 {{ margin:0 0 4px; font-size:20px; letter-spacing:-0.02em; }}
  .sub {{ color:var(--muted); }}
  main {{ padding:24px 28px; }}
  table {{ width:100%; border-collapse:collapse; background:var(--card); border-radius:12px; overflow:hidden; }}
  th,td {{ text-align:left; padding:10px 14px; border-bottom:1px solid #1e2a44; }}
  th {{ color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.04em; }}
  a {{ color:var(--accent); text-decoration:none; }}
  a:hover {{ text-decoration:underline; }}
  code {{ background:#1a243d; padding:1px 6px; border-radius:4px; }}
</style>
<meta http-equiv="refresh" content="5"/>
</head><body>
<header>
  <h1>{PRODUCT}</h1>
  <div class="sub">{DASHBOARD_SUBTITLE}</div>
</header>
<main>
  <table>
    <thead><tr><th>Run</th><th>Mode</th><th>OK</th><th>Elapsed</th></tr></thead>
    <tbody>{body}</tbody>
  </table>
</main>
</body></html>"""


def _html_run(data: dict[str, Any]) -> str:
    synth = (data.get("synthesis") or "").replace("<", "&lt;")
    route = (data.get("route_text") or "").replace("<", "&lt;")
    replies = data.get("replies") or {}
    blocks = []
    for prov, rep in replies.items():
        if not isinstance(rep, dict):
            continue
        text = (rep.get("text") or rep.get("error") or "").replace("<", "&lt;")
        st = rep.get("status")
        blocks.append(f"<section><h3>{prov} · {st}</h3><pre>{text}</pre></section>")
    return f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>{data.get('run_id')} · {PRODUCT}</title>
<style>
  :root {{ color-scheme: dark; --bg:#0b1020; --card:#121a2f; --fg:#e8eefc; --muted:#8b9bb8; --accent:#7c5cff; }}
  body {{ margin:0; font:14px/1.5 ui-sans-serif,system-ui,Segoe UI,sans-serif; background:var(--bg); color:var(--fg); }}
  header {{ padding:20px 28px; border-bottom:1px solid #1e2a44; }}
  a {{ color:var(--accent); }}
  main {{ padding:24px 28px; max-width:960px; }}
  pre {{ background:var(--card); padding:14px; border-radius:10px; overflow:auto; white-space:pre-wrap; }}
  section {{ margin:18px 0; }}
  h3 {{ margin:0 0 8px; font-size:14px; color:var(--muted); }}
</style>
</head><body>
<header>
  <a href="/">← {PRODUCT} board</a>
  <h1 style="margin:8px 0 0">{data.get('run_id')}</h1>
  <div style="color:var(--muted)">{route}</div>
</header>
<main>
  <section><h3>Synthesis</h3><pre>{synth or '(none)'}</pre></section>
  {''.join(blocks)}
</main>
</body></html>"""


class _Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return  # quiet

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        if path in {"/", "/index.html"}:
            body = _html_index(list_local_runs()).encode("utf-8")
            self._ok(body, "text/html; charset=utf-8")
            return
        if path.startswith("/run/"):
            rid = path.split("/run/", 1)[1].strip("/")
            result = project_state_dir() / "runs" / rid / "result.json"
            if not result.is_file():
                self.send_error(404, "run not found")
                return
            data = json.loads(result.read_text(encoding="utf-8"))
            body = _html_run(data).encode("utf-8")
            self._ok(body, "text/html; charset=utf-8")
            return
        if path == "/api/runs":
            body = json.dumps(list_local_runs(), default=str).encode("utf-8")
            self._ok(body, "application/json")
            return
        self.send_error(404)

    def _ok(self, body: bytes, ctype: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def serve_local(
    *,
    host: str = "127.0.0.1",
    port: int = 8787,
    open_browser: bool = True,
) -> str:
    httpd = ThreadingHTTPServer((host, port), _Handler)
    url = f"http://{host}:{port}/"
    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()
    print(f"{PRODUCT} board → {url}")
    print("Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        httpd.server_close()
    return url


def open_dashboard(
    job_id: Optional[str] = None,
    *,
    port: int = 8787,
    host: str = "127.0.0.1",
    open_browser: bool = True,
    prefer_pm: bool = True,
    background: bool = False,
) -> dict[str, Any]:
    """Prefer Puppetmaster durable board when available; else local runs board."""
    if prefer_pm and puppetmaster_available() and job_id:
        return pm_start(
            job_id,
            port=port,
            host=host,
            open_browser=open_browser,
            background=background,
        )
    if prefer_pm and puppetmaster_available() and not job_id:
        # Still offer PM multi-job index if user wants durable PM jobs;
        # local Codefusion runs are always on the lightweight board.
        # Default: local board for Codefusion-native runs.
        pass
    if background:
        # Detached local board
        import subprocess
        import sys

        cmd = [
            sys.executable,
            "-m",
            "codefusion",
            "dashboard",
            "--port",
            str(port),
            "--host",
            host,
            "--no-open" if not open_browser else "--open",
            "--local",
        ]
        # strip --open handling — use flags we support
        cmd = [
            sys.executable,
            "-c",
            (
                "from codefusion.dashboard import serve_local; "
                f"serve_local(host={host!r}, port={port}, open_browser={open_browser})"
            ),
        ]
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return {"ok": True, "url": f"http://{host}:{port}/", "background": True}

    serve_local(host=host, port=port, open_browser=open_browser)
    return {"ok": True, "url": f"http://{host}:{port}/"}
