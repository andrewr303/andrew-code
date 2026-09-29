# Installing Fusion

> Codex conversion note: for this installed copy, use `codex plugin add
> fusion@personal` or run `install.ps1` / `install.bat`. See `CODEX.md` for the
> active Codex-specific instructions. The older Claude install notes below are
> retained only as source history.

Fusion is a Claude Code plugin — but it's more than skills: it shells out to external
coding CLIs and runs a Python swarm engine. So installing it means **(1) prepare the
environment, (2) verify it actually dispatches, (3) register it with Claude Code.** The
installer does all three.

## Prerequisites

| Requirement | Why | Notes |
|---|---|---|
| **Claude Code** ≥ 2.1 | the host / orchestrator | `claude --version` |
| **Git Bash** (Windows) | every Fusion script + the Python bridge run under it | [git-scm.com](https://git-scm.com/download/win); macOS/Linux use the system shell |
| **Python 3** | the swarm engine (`fusion_swarm`) | stdlib only — nothing to pip install |
| **jq** | full learning ledger | optional. Install — Windows: `winget install jqlang.jq` · macOS: `brew install jq` · Linux: `sudo apt install jq` |
| Panel CLIs: **codex · copilot · opencode · grok** | the panelists | install + log into the ones you want; Claude is the always-on judge |

## Quick install (recommended)

From the plugin directory:

```bash
# Windows (PowerShell or cmd) — foolproof, pins Git Bash:
install.bat
#   …or:  powershell -ExecutionPolicy Bypass -File install.ps1

# macOS / Linux / Git Bash:
bash install.sh
```

> **Windows gotcha (important):** do **not** run `bash install.sh` from PowerShell or cmd.
> Windows resolves a bare `bash` to **WSL** — a separate Linux environment that can't see your
> Windows-installed CLIs (codex/copilot/grok), `claude`, `python`, or `jq`. You'll spot it by a
> `/mnt/c/...` plugin root and most checks showing "missing". Use `install.bat` / `install.ps1`,
> or open **Git Bash** (not WSL) and run `bash install.sh` there.

This makes scripts executable, checks dependencies, **validates the manifest**
(`claude plugin validate`), runs the offline contract gate, detects your panel CLIs, seeds
runtime state in `~/.fusion`, and **registers the plugin** with Claude Code. Then restart
Claude Code.

Flags: `--smoke` (live one-word dispatch per panelist), `--no-register` (prep + verify only,
print the commands), `--scope user|project|local`, `--dry-run`.

## Manual install (scriptable, no installer)

The installer just runs these — you can too, from any shell with the `claude` CLI:

```bash
claude plugin marketplace add /path/to/fusion          # add this dir as a marketplace
claude plugin install fusion@fusion-marketplace        # install (--scope user|project|local)
claude plugin enable fusion                            # if not auto-enabled
# restart Claude Code
```

## Try it for one session (no install)

```bash
claude --plugin-dir /path/to/fusion        # loads the plugin for this session only
```

## Inside Claude Code (interactive)

```
/plugin marketplace add /path/to/fusion
/plugin install fusion@fusion-marketplace
```

## Verify

In a Claude Code session after restart:

```
/fusion:setup            # detects panelists + reports readiness
/fusion:setup --smoke    # proves real (non-simulated) dispatch
```

Or from a shell: `bash install.sh --smoke`.

## What gets installed where

- **The plugin** → Claude Code's plugin store (managed by `claude plugin …`). Skills,
  commands, scripts, and the Python engine travel together; `$FUSION_PLUGIN_ROOT` resolves
  to the installed location at runtime.
- **Runtime state** → `~/.fusion/` (the learning ledger `memory/runs.jsonl`, distilled
  `memory/lessons.md`, session degraded-provider list). It lives **outside** the plugin dir so
  it survives plugin updates and works even if the plugin dir is read-only. The shipped
  `memory/` is only a seed, copied in on first use.

## Configure the panel models (recommended: Claude Code plugin config)

Every panelist's model is a first-class plugin option — set them through Claude Code's own
config flow, no file editing:

```bash
# at install time (repeatable --config):
claude plugin install fusion@fusion-marketplace \
  --config codex_model=gpt-5.5 --config codex_effort=high \
  --config copilot_model=gemini-3.5-flash \
  --config opencode_model=opencode-go/glm-5.2 --config opencode_variant=high \
  --config grok_model=

# or interactively any time:
/plugin            # → configure → fusion → edit the model fields
```

| Option (`--config key=…`) | Panelist | Blank → default |
|---|---|---|
| `codex_model` / `codex_effort` | 🔴 codex (OpenAI) | `gpt-5.5` / `xhigh` |
| `copilot_model` | 🔷 copilot (Google) | `gemini-3.5-flash` |
| `opencode_model` / `opencode_variant` | 🟢 opencode (GLM) | `opencode-go/glm-5.2` / `high` |
| `grok_model` | ⬛ grok (xAI) | grok's built-in `grok build` |

These are exported to Fusion's scripts as `CLAUDE_PLUGIN_OPTION_<key>` and mapped to the
adapters automatically. Leave any blank to use the default above.

### Other config (env vars / file)

Defaults are baked in; override without editing code. **Precedence:** explicit `FUSION_*`
env var > `config/defaults.env` (if uncommented) > plugin userConfig > baked default.

- **Timeouts / extra overrides** via env vars (or uncomment `config/defaults.env`):
  `FUSION_<PROV>_TIMEOUT` (seconds), and the same `FUSION_CODEX_MODEL` / `FUSION_CODEX_EFFORT`
  / `FUSION_COPILOT_MODEL` / `FUSION_OPENCODE_MODEL` / `FUSION_OPENCODE_VARIANT` /
  `FUSION_GROK_MODEL` the options map to.
- **Restrict the panel:** put provider names (one per line) in `~/.fusion/panel-allowlist`.
- **Pin Git Bash / Python** (rarely needed): `FUSION_BASH`, `FUSION_PYTHON`.
- **Relocate state:** `FUSION_STATE_DIR` (default `~/.fusion`), `FUSION_MEMORY_DIR`.

## Update / uninstall

```bash
claude plugin update fusion          # pull the latest (restart to apply)
claude plugin uninstall fusion       # remove the plugin (leaves ~/.fusion learning intact)
claude plugin marketplace remove fusion-marketplace
```

## Troubleshooting

- **A panelist shows `missing`** → its CLI isn't installed or not on PATH. **`degraded`** →
  installed but auth/quota looks dead this session.
- **Dispatch returns nothing on Windows** → the Python engine must use Git Bash, not WSL.
  It auto-pins Git Bash; override with `FUSION_BASH=/c/Program Files/Git/bin/bash.exe`.
- **`/fusion:*` commands don't appear** → restart Claude Code after install; check
  `claude plugin list`.
- **Validate anytime:** `claude plugin validate /path/to/fusion` and `bash tests/validate.sh`.
