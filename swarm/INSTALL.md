# Installing Fusion

> Hosts: **Kimi Code / AndrewCode** need `kimi.plugin.json` — see [`KIMI.md`](KIMI.md).
> **Codex** uses `codex plugin add fusion@personal` — see [`CODEX.md`](CODEX.md).
> Claude Code notes below are retained as source history.

Fusion shells out to external coding CLIs and runs a Python swarm engine. Installing
it means **(1) prepare the environment, (2) verify it actually dispatches, (3) register
it with the host(s) you have.** The installer does all three.

## Prerequisites

| Requirement | Why | Notes |
|---|---|---|
| **Kimi Code / AndrewCode** *or* **Codex** *or* **Claude Code** ≥ 2.1 | host / orchestrator | `andrewcode --version` / `kimi --version` / `codex --version` / `claude --version` |
| **Git Bash** (Windows) | every Fusion script + the Python bridge run under it | [git-scm.com](https://git-scm.com/download/win); macOS/Linux use the system shell |
| **Python 3** | the swarm engine (`fusion_swarm`) + Kimi installer | stdlib only — nothing to pip install |
| **jq** | full learning ledger | optional. Install — Windows: `winget install jqlang.jq` · macOS: `brew install jq` · Linux: `sudo apt install jq` |
| Panel CLIs: **codex · copilot · opencode · grok · andrewcode** | the panelists | install + log into the ones you want |

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

This makes scripts executable, checks dependencies, **validates the manifests**
(`kimi.plugin.json` + `.codex-plugin/plugin.json`), runs the offline contract gate, detects
your panel CLIs, seeds runtime state in `~/.fusion`, and **registers the plugin**:

- **Kimi / AndrewCode** → `python scripts/install-kimi.py` copies the plugin *surface*
  into `~/.andrewcode/plugins/managed/fusion` (vendor trees are not copied) and upserts
  `plugins/installed.json`. Then `/plugins reload` and `/new`.
- **Codex** → `codex plugin add fusion@personal` if `codex` is on PATH.

Do **not** `/plugins install` this full checkout from Kimi if it still contains vendor
trees (`kimi-code/`, `andrewagent/`, …) — that copies everything. Use `install.bat`.

Flags: `--smoke` (live one-word dispatch per panelist), `--no-register` (prep + verify only,
print the commands), `--scope user|project|local`, `--dry-run`.

## Manual install (scriptable, no installer)

**Kimi Code / AndrewCode** (preferred on this machine):

```bash
python scripts/install-kimi.py
# then in AndrewCode:
#   /plugins reload
#   /new
#   /fusion:setup
```

**Codex:**

```bash
codex plugin add fusion@personal
```

**Claude Code:**

```bash
claude plugin marketplace add /path/to/fusion
claude plugin install fusion@fusion-marketplace
claude plugin enable fusion
```

## Try it for one session (no install)

```bash
claude --plugin-dir /path/to/fusion        # Claude Code, this session only
```

Kimi / AndrewCode always copies into `plugins/managed/` — there is no session-only
`--plugin-dir`. Use `python scripts/install-kimi.py`.

## Inside Kimi / AndrewCode (interactive)

```
/plugins install C:\dev\Plugins\fusion\fusion
```

Only after the directory is a **slim** plugin (has `kimi.plugin.json` and does not
contain vendor trees). Prefer `install.bat`.

## Inside Claude Code (interactive)

```
/plugin marketplace add /path/to/fusion
/plugin install fusion@fusion-marketplace
```

## Verify

In a Kimi / AndrewCode / Claude Code session after reload:

```
/fusion:setup            # detects panelists + reports readiness
/fusion:setup --smoke    # proves real (non-simulated) dispatch
/plugins info fusion     # Kimi: manifest, skills, commands, diagnostics
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
- **`/fusion:*` commands don't appear (Kimi)** → missing `kimi.plugin.json` is the
  usual cause (`No manifest at kimi.plugin.json or .kimi-plugin/plugin.json`). Run
  `python scripts/install-kimi.py`, then `/plugins reload` and `/new`. Check
  `/plugins info fusion`.
- **`/fusion:*` commands don't appear (Claude)** → restart Claude Code after install;
  check `claude plugin list`.
- **`/plugins install` copied the whole mega-checkout** → remove the plugin
  (`/plugins remove fusion`) and reinstall with `install.bat` / `scripts/install-kimi.py`.
- **Validate anytime:** `claude plugin validate /path/to/fusion` and `bash tests/validate.sh`.
