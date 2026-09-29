# Fusion on Kimi Code / AndrewCode

Kimi Code and AndrewCode (the Kimi Code fork at `C:\Users\Andrew\.andrewcode`)
do **not** read `.claude-plugin/` or `.codex-plugin/`. They need a Kimi
manifest at one of:

```
<plugin_root>/kimi.plugin.json
<plugin_root>/.kimi-plugin/plugin.json
```

Fusion ships both. `kimi.plugin.json` wins if both exist.

## Install (recommended)

From the plugin directory, on Windows use Git Bash via the launcher:

```powershell
.\install.bat
# or
powershell -ExecutionPolicy Bypass -File install.ps1
```

That:

1. Checks Git Bash + Python
2. Runs `tests/validate.sh`
3. Copies the **plugin surface only** (skills, commands, scripts, python, …)
   into `~/.andrewcode/plugins/managed/fusion` — it does **not** copy vendor
   trees (`kimi-code/`, `andrewagent/`, `cccc/`, …)
4. Upserts `~/.andrewcode/plugins/installed.json`
5. Also registers with Codex if `codex` is on PATH (`codex plugin add fusion@personal`)

Then in AndrewCode / Kimi:

```
/plugins reload
/new
/fusion:setup
```

## Manual install (no installer)

In a Kimi / AndrewCode session:

```
/plugins install C:\dev\Plugins\fusion\fusion
```

**Do not do that if this checkout still contains vendor trees.** `/plugins install`
copies the whole directory. Use `install.bat` / `scripts/install-kimi.py` instead,
or pass a slim copy.

Direct Python (same as the installer):

```bash
python scripts/install-kimi.py
```

Override the home dir with `ANDREWCODE_HOME` or `KIMI_CODE_HOME`.

## After install

Plugin commands are namespaced: `/fusion:hive`, `/fusion:designer`, `/fusion:board`,
`/fusion:metaloop`, `/fusion:panel`, …

Nested hive workers still spawn **real** `andrewcode` processes:

```
andrewcode -p "…" -m <model> --auto --yolo --output-format text
```

Hive Board:

```
python -m fusion_swarm.board --db "$FUSION_BOARD" poll --agent "$FUSION_AGENT_ID"
```

(`PYTHONPATH` must include the plugin's `python/` directory; `scripts/swarm.sh`
and `scripts/board.sh` set that.)

## Verify

```
/plugins info fusion
/fusion:setup
bash scripts/swarm.sh hive "smoke" --dry-run --json
```

A missing Kimi manifest is the failure mode this file exists to prevent:
`No manifest at kimi.plugin.json or .kimi-plugin/plugin.json`.
