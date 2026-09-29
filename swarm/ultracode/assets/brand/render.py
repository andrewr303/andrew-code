#!/usr/bin/env python3
"""
Render the brand HTML sources in this folder to PNG at 2x (HiDPI), matching the
other README visuals. Requires Playwright + Chromium:

    pip install playwright && python -m playwright install chromium
    python assets/brand/render.py                # render all *.html here
    python assets/brand/render.py auto-router     # render a single source

Each <name>.html with a `body{width:Wpx;height:Hpx}` rule renders to <name>.png
at W*2 x H*2.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _size(html: str):
    m = re.search(r"body\s*\{[^}]*?width:\s*(\d+)px;\s*height:\s*(\d+)px", html, re.S)
    return (int(m.group(1)), int(m.group(2))) if m else (1280, 600)


def render(stem: str):
    from playwright.sync_api import sync_playwright
    src = HERE / (stem + ".html")
    html = src.read_text(encoding="utf-8")
    w, h = _size(html)
    out = HERE / (stem + ".png")
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox", "--force-color-profile=srgb"])
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2)
        pg.goto(src.as_uri())
        try:
            pg.wait_for_timeout(1200)  # let webfonts settle
        except Exception:
            pass
        pg.screenshot(path=str(out), clip={"x": 0, "y": 0, "width": w, "height": h})
        b.close()
    print("rendered %s -> %s (%dx%d)" % (src.name, out.name, w * 2, h * 2))


def main(argv):
    stems = argv[1:] or [p.stem for p in sorted(HERE.glob("*.html"))]
    for s in stems:
        render(s)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
