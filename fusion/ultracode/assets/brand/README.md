# Brand / README visuals

Premium graphics used by the root `README.md`. All are rendered at 2× for crisp
display on HiDPI screens.

| File | Used for | Canvas |
|------|----------|--------|
| `hero.png` | README header banner | 1280×400 |
| `features.png` | Feature highlights row | 1280×360 |
| `architecture.png` | "How it works" flow diagram | 1280×600 |
| `quickstart.png` | Three-step quick start strip | 1280×330 |
| `auto-router.png` | Auto Router "how it routes" diagram | 1280×650 |
| `doc-setup.png` | `docs/SETUP.md` header | 1280×210 |
| `doc-how.png` | `docs/HOW_IT_WORKS.md` header | 1280×210 |
| `doc-add.png` | `docs/ADD_A_MODEL.md` header | 1280×210 |
| `doc-trouble.png` | `docs/TROUBLESHOOTING.md` header | 1280×210 |

The animated demo lives at [`../demo/demo.gif`](../demo/demo.gif).

Palette: indigo `#6366f1` → violet `#8b5cf6` → purple `#a855f7` → fuchsia
`#c026d3` on a near-black `#0a0c14` background, matching the `ultracode` app icon.
Type is Inter (display/body) and JetBrains Mono (code).

## Regenerating

`auto-router.png` ships with its HTML/CSS source (`auto-router.html`) and a
renderer. To regenerate it (or add a new graphic the same way):

```
pip install playwright && python -m playwright install chromium
python assets/brand/render.py auto-router      # or: render.py  (all *.html here)
```

`render.py` reads the `body{width;height}` from each `*.html` and screenshots it
at `device_scale_factor=2`, so the output is exactly 2× the canvas.
