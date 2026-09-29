#!/usr/bin/env bash
# fusion/install.sh — one-command installer for the Fusion Codex plugin.
#
# Fusion is more than a bundle of skills: it shells out to external CLIs and runs
# a Python swarm engine, so "install" means (1) prepare the environment, (2) verify
# it actually dispatches, and (3) register the plugin with Codex.
#
# Usage:
#   bash install.sh                 # full install: prep + verify + register (user scope)
#   bash install.sh --smoke         # also run a live one-word dispatch per panelist
#   bash install.sh --no-register   # prep + verify only; print the /plugin commands
#   bash install.sh --scope project # accepted for compatibility; ignored by Codex
#   bash install.sh --dry-run       # show what it would do; no side effects
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARKET_NAME="personal"

SCOPE="user"; REGISTER=1; SMOKE=0; DRYRUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --smoke) SMOKE=1;;
    --no-register) REGISTER=0;;
    --scope) shift; SCOPE="${1:-user}";;
    --dry-run) DRYRUN=1;;
    -h|--help) sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac; shift
done

ok=0; warn=0
say()  { printf '%s\n' "$*"; }
good() { printf '  \033[32m✔\033[0m %s\n' "$*"; ok=$((ok+1)); }
note() { printf '  \033[33m›\033[0m %s\n' "$*"; warn=$((warn+1)); }
bad()  { printf '  \033[31mx\033[0m %s\n' "$*"; }
run()  { if [ "$DRYRUN" = 1 ]; then printf '    [dry-run] %s\n' "$*"; else "$@"; fi; }
have() { command -v "$1" >/dev/null 2>&1; }

say "✦ Fusion installer"
say "  plugin root: $ROOT"
[ "$DRYRUN" = 1 ] && say "  (dry-run — no changes will be made)"
say ""

# WSL trap: `bash install.sh` from PowerShell/cmd often resolves to WSL bash,
# whose Linux environment can't see your Windows CLIs / codex / python / jq.
# (Tell-tale: plugin root starts with /mnt/.)
if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi 'microsoft' /proc/version 2>/dev/null || case "$ROOT" in /mnt/*) true;; *) false;; esac; then
  printf '  \033[33m⚠  You appear to be running under WSL, not Git Bash.\033[0m\n'
  printf '     WSL is a separate Linux env — your Windows codex/copilot/grok,\n'
  printf '     python and jq are likely invisible here, so the checks below will fail.\n'
  printf '     On Windows, install with one of these instead (from PowerShell or cmd):\n'
  printf '         \033[36minstall.bat\033[0m                                    (foolproof)\n'
  printf '         \033[36mpowershell -ExecutionPolicy Bypass -File install.ps1\033[0m\n'
  printf '       …or open \033[36mGit Bash\033[0m (not WSL) and run:  bash install.sh\n\n'
fi

# 1) executable bits ---------------------------------------------------------
say "[1] making scripts executable"
run chmod +x "$ROOT"/scripts/*.sh "$ROOT"/scripts/providers/*.sh "$ROOT"/tests/*.sh "$ROOT"/install.sh 2>/dev/null || true
good "scripts are executable"

# 2) dependencies ------------------------------------------------------------
say "[2] checking dependencies"
PYBIN=""; for c in python py python3; do command -v "$c" >/dev/null 2>&1 && { PYBIN="$c"; break; }; done
if [ -n "$PYBIN" ]; then good "python found ($("$PYBIN" --version 2>&1 | head -1))"; else bad "python not found — the swarm engine needs Python 3 (install Python, or use python3)"; fi
if have jq; then good "jq found (full learning ledger)"; else note "jq not found — ledger works in degraded mode; install jq for full learning"; fi
if have codex; then good "codex CLI found ($(codex --version 2>&1 | head -1))"; else note "codex CLI not on PATH — will print manual install steps"; fi
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*) good "Git Bash detected (Windows)";;
  *) good "POSIX shell";;
esac

# 3) validate the plugin manifest shape -------------------------------------
say "[3] validating plugin manifest shape"
if [ -f "$ROOT/.codex-plugin/plugin.json" ]; then
  good ".codex-plugin/plugin.json present"
else
  bad ".codex-plugin/plugin.json missing"
fi

# 4) offline contract gate ---------------------------------------------------
say "[4] running the offline contract gate (tests/validate.sh)"
if [ "$DRYRUN" = 1 ]; then say "    [dry-run] bash tests/validate.sh"
elif bash "$ROOT/tests/validate.sh" >/tmp/fusion-gate.$$ 2>&1; then good "all checks passed"
else bad "validate.sh failed:"; tail -8 /tmp/fusion-gate.$$ | sed 's/^/      /'; fi
rm -f /tmp/fusion-gate.$$ 2>/dev/null || true

# 5) detect panelist CLIs ----------------------------------------------------
say "[5] detecting panelist CLIs"
if [ "$DRYRUN" = 1 ]; then say "    [dry-run] scripts/providers/detect.sh"
else
  live=0
  while IFS=: read -r name status; do
    case "$name" in claude|codex) continue;; PROVIDER_CHECK*) continue;; esac
    [ -z "$name" ] && continue
    if [ "$status" = "available" ]; then good "$name: $status"; live=$((live+1)); else note "$name: $status"; fi
  done < <(bash "$ROOT/scripts/providers/detect.sh")
  if [ "$live" -ge 1 ]; then good "$live external panelist(s) live (Codex is the judge)"; else note "no external panelists live — Fusion will fall back to solo Codex mode"; fi
fi

# 6) seed runtime state (~/.fusion) -----------------------------------------
say "[6] seeding runtime state in \${FUSION_STATE_DIR:-~/.fusion}"
run bash "$ROOT/scripts/ledger.sh" lessons >/dev/null 2>&1 || true
good "ledger + lessons seeded (state lives in ~/.fusion, survives plugin updates)"

# 7) register with Codex -----------------------------------------------------
say "[7] registering the plugin with Codex"
if [ "$SCOPE" != "user" ]; then
  note "--scope $SCOPE accepted for compatibility; Codex installs local plugins from the configured marketplace"
fi
if [ "$REGISTER" = 1 ] && have codex; then
  run codex plugin add "fusion@$MARKET_NAME"
  good "registered fusion@$MARKET_NAME — start a new Codex thread to load it"
else
  note "auto-register skipped — run this yourself in a shell with the codex CLI:"
  say  "      codex plugin add fusion@$MARKET_NAME"
fi

# 8) optional live smoke -----------------------------------------------------
if [ "$SMOKE" = 1 ] && [ "$DRYRUN" = 0 ]; then
  say "[8] live smoke test (one-word prompt per panelist — costs a little)"
  bash "$ROOT/tests/smoke-providers.sh" || true
fi

# done -----------------------------------------------------------------------
say ""
say "✦ Fusion install complete  (${ok} ok, ${warn} note(s))"
say "  next:  ask Codex: \"fusion setup\""
say "         ask Codex: \"use Fusion on <task>\""
say "         ask Codex: \"use Fusion gate with pytest -q\""
say ""
say "  A Fusion panel runs paid CLIs (~2–5× a single call). It earns that when being"
say "  wrong is expensive — and answers 'solo' when it wouldn't."
