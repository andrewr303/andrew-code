---
"@moonshot-ai/kimi-code": minor
---

Add three terminal UI improvements:

- Model favorites: press Alt+F in the model picker to star a model. Starred models lead the picker as a "★ Favorites" panel that opens first, and the set persists in `~/.kimi-code/tui.toml` (`model_favorites`).
- `/mcp` now opens an interactive MCP server manager (add, edit, remove, enable/disable) over the user's global `mcp.json`; the read-only status report is still one keypress away (`s`).
- `/swarm` with no arguments now opens a visual configuration dialog — pick the swarm's models from the session's configured models, choose the swarm pattern, then confirm from the summary panel. `/swarm on`, `/swarm off`, and `/swarm <task>` keep their previous behavior.
