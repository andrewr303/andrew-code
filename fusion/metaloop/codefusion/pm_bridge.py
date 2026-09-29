"""Puppetmaster bridge — durable jobs + dashboard under Codefusion branding.

Cost-aware routing is NOT used. Codefusion's capability router decides modes;
Puppetmaster supplies durable worker processes, SQLite artifacts, and the board.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Optional

from codefusion.branding import rebrand_text
from codefusion.paths import PUPPETMASTER_ROOT, ensure_vendor_paths, project_state_dir


def puppetmaster_available() -> bool:
    ensure_vendor_paths()
    if not PUPPETMASTER_ROOT.is_dir():
        return False
    try:
        import puppetmaster  # noqa: F401

        return True
    except ImportError:
        return False


def _prepare_env() -> None:
    ensure_vendor_paths()
    # Point PM state at Codefusion project state when unset.
    os.environ.setdefault("PUPPETMASTER_STATE_DIR", str(project_state_dir() / "pm"))
    os.environ.setdefault("CODEFUSION_EMBEDDED_PM", "1")


def run_pm_main(argv: list[str]) -> int:
    """Invoke puppetmaster CLI with rebranded argv product name only."""
    if not puppetmaster_available():
        print("Puppetmaster sources not found under Puppetmaster-main/", file=sys.stderr)
        return 2
    _prepare_env()
    from puppetmaster.cli import main as pm_main

    # Puppetmaster main reads sys.argv
    old = sys.argv
    try:
        sys.argv = ["codefusion-pm", *argv]
        return int(pm_main() or 0)
    finally:
        sys.argv = old


def start_dashboard(
    job_id: Optional[str] = None,
    *,
    port: int = 8787,
    host: str = "127.0.0.1",
    open_browser: bool = True,
    background: bool = False,
    all_projects: bool = False,
) -> dict[str, Any]:
    """Start the live swarm board (rebranded)."""
    if not puppetmaster_available():
        return {
            "ok": False,
            "error": "Puppetmaster not available — dashboard requires Puppetmaster-main/",
        }
    _prepare_env()
    try:
        from puppetmaster import dashboard as pm_dash
        from puppetmaster.store_factory import open_default_store
    except ImportError as exc:
        return {"ok": False, "error": f"dashboard import failed: {exc}"}

    # Monkey-patch HTML builder if present for branding.
    _patch_dashboard_branding(pm_dash)

    store = open_default_store()
    try:
        # serve(job_id=..., port=..., host=..., open_browser=...)
        serve_kwargs: dict[str, Any] = {
            "port": port,
            "host": host,
        }
        # API varies slightly across versions — probe signature.
        import inspect

        sig = inspect.signature(pm_dash.serve)
        params = set(sig.parameters)
        if "open_browser" in params:
            serve_kwargs["open_browser"] = open_browser
        if job_id and "job_id" in params:
            serve_kwargs["job_id"] = job_id
        if all_projects and "all_projects" in params:
            serve_kwargs["all_projects"] = all_projects

        if background:
            # Prefer detached helper if exists
            if hasattr(pm_dash, "serve_background"):
                url = pm_dash.serve_background(**serve_kwargs)
                return {"ok": True, "url": url, "background": True}
            # Fallback: note that serve blocks
            return {
                "ok": False,
                "error": "background dashboard not supported in this Puppetmaster version; run without --background",
                "hint": f"codefusion dashboard --port {port}",
            }

        # Blocking serve
        result = pm_dash.serve(**serve_kwargs)
        return {"ok": True, "result": result, "url": f"http://{host}:{port}/"}
    except TypeError:
        # Older API: serve(store, ...)
        try:
            pm_dash.serve(store, port=port)  # type: ignore[misc]
            return {"ok": True, "url": f"http://{host}:{port}/"}
        except Exception as exc:  # noqa: BLE001
            return {"ok": False, "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


def _patch_dashboard_branding(pm_dash: Any) -> None:
    """Best-effort rebrand of inlined HTML strings."""
    for attr in ("_PAGE_HTML", "PAGE_HTML", "_INDEX_HTML", "INDEX_HTML", "_HTML"):
        if hasattr(pm_dash, attr):
            val = getattr(pm_dash, attr)
            if isinstance(val, str):
                setattr(pm_dash, attr, rebrand_text(val))
    # Wrap build functions that return HTML
    for fname in ("_render_page", "render_page", "build_html"):
        if hasattr(pm_dash, fname):
            orig = getattr(pm_dash, fname)

            def wrapped(*args: Any, __orig=orig, **kwargs: Any) -> Any:
                out = __orig(*args, **kwargs)
                if isinstance(out, str):
                    return rebrand_text(out)
                return out

            try:
                setattr(pm_dash, fname, wrapped)
            except Exception:
                pass


def pm_doctor() -> str:
    if not puppetmaster_available():
        return "Puppetmaster bridge: unavailable (Puppetmaster-main not importable)"
    _prepare_env()
    try:
        from puppetmaster import __version__ as pm_ver  # type: ignore
    except Exception:
        pm_ver = "unknown"
    return f"Puppetmaster bridge: available (v{pm_ver}) · state={project_state_dir() / 'pm'}"
