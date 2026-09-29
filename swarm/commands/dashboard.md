---
description: Launch the Fusion localhost config dashboard — live provider/model status, an editor for config/defaults.env, and a parsed view of every /fusion:<mode> command's declared roster. Read-only where it can't be safely made otherwise; localhost-only, session-token-gated writes.
argument-hint: [--port N] [--no-open]
---

CRITICAL — DIRECT EXECUTION: launch immediately with a *relative* path from the
plugin/workspace root. Do NOT search the disk first (`find ~`, broad `ls`,
`grep installed_plugins`) — these hang on Windows/OneDrive and are unnecessary;
the dashboard scripts are always at `scripts/dashboard.sh` and
`scripts/dashboard_server.py`.

Run:

```
bash scripts/dashboard.sh
```

Honor `$ARGUMENTS`:
- `--port N` → `FUSION_DASHBOARD_PORT=N bash scripts/dashboard.sh`
- `--no-open` → `FUSION_DASHBOARD_NO_OPEN=1 bash scripts/dashboard.sh` (don't auto-open a browser tab; just print the URL)

The server prints the bound URL (`http://127.0.0.1:<port>/`) and opens it in
the default browser unless `--no-open` was given. It binds to 127.0.0.1 only.

What it shows:
- **Providers & Models** — live tri-state status (live/degraded/missing/
  host-native) for codex, copilot, opencode, grok, agy, fable, with a live
  model list per provider (cached; a per-card Refresh re-probes). OpenCode
  models are split into Subscription (`opencode-go/*`) vs Direct API
  (key-dependent, e.g. `meta/muse-*`).
- **Config** — every `FUSION_*` key in `config/defaults.env` with its
  effective value and which layer of the precedence chain supplies it
  (explicit env > defaults.env > plugin config > baked default). Edits are
  surgical (only the targeted line changes; a timestamped backup is written
  to `config/.backups/` first) and require the page's own session token, so
  a stray script on the machine can't rewrite your config just because the
  port is open.
- **Swarm Modes** — every `/fusion:<mode>` command parsed live from
  `commands/*.md`, showing its declared engine pattern (if the Python engine
  backs it) or an honest "dynamic — decided by the invoked skill" note when
  it doesn't.

To stop the server: Ctrl-C in the terminal running it (it does not daemonize).
