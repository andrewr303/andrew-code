#!/usr/bin/env bash
# fusion/scripts/providers/agy.sh — MetaLoop FAST-lane adapter for Antigravity CLI (`agy`).
#
# Usage: agy.sh <prompt_file> <out_file> [model]
#
# Antigravity CLI is a newer terminal product and is NOT guaranteed to share
# Gemini/Copilot CLI flags one-for-one (MetaLoop outline §16). So this adapter
# does NOT blindly reuse another Gemini harness's flags: it capability-detects
# the installed `agy` and fails VISIBLY if the non-interactive print interface it
# needs is absent, rather than silently producing nothing.
#
# Verified working shape (agy print mode):
#   agy --print "<text>" --model "Gemini 3.1 Pro (High)" --print-timeout <Ns>
#       --new-project --add-dir <dir> --dangerously-skip-permissions
# Note: agy runs a Gemini-family model; in MetaLoop it is correlated with the
# Copilot Gemini harness and the two never count as two independent votes.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
. "$DIR/_common.sh"

prompt_file="${1:?usage: agy.sh <prompt_file> <out_file> [model]}"
out_file="${2:?missing out_file}"
model="${3:-${FUSION_AGY_MODEL:-Gemini 3.1 Pro (High)}}"
timeout_s="${FUSION_AGY_TIMEOUT:-600}"

command -v agy >/dev/null 2>&1 || { echo "[fusion] agy (Antigravity CLI) not installed" >&2; exit 127; }

# --- capability detection ---------------------------------------------------
# Feature-detect the flags MetaLoop relies on. If the installed agy lacks a
# non-interactive print flag, do NOT guess — fail visibly (rc=1) so the run's
# fallback chain (copilot → expert → host) engages instead of a blank worker.
help_text="$(agy --help 2>&1 || true)"
have_flag() { printf '%s' "$help_text" | grep -qE -- "$1"; }

PRINT_FLAG=""
if   have_flag '(^|[[:space:]])--print([[:space:]]|=|$)';       then PRINT_FLAG="--print"
elif have_flag '(^|[[:space:]])--prompt([[:space:]]|=|$)';      then PRINT_FLAG="--prompt"
elif have_flag '(^|[[:space:]])-p([[:space:]]|,|$)';            then PRINT_FLAG="-p"
fi
if [ -z "$PRINT_FLAG" ]; then
  # Help text may be unavailable/opaque on some builds; fall back to the verified
  # --print shape but record that detection was inconclusive.
  echo "[fusion] agy: could not detect a print flag from --help; assuming --print (verified shape)" >&2
  PRINT_FLAG="--print"
fi

MODEL_FLAG="--model"; have_flag '(^|[[:space:]])-m([[:space:]]|,|$)' && ! have_flag -- '--model' && MODEL_FLAG="-m"
DIR_FLAG="--add-dir"
have_flag -- '--add-dir' || { have_flag -- '--cwd' && DIR_FLAG="--cwd"; }
have_flag -- '--add-dir' || have_flag -- '--cwd' || { have_flag -- '--dir' && DIR_FLAG="--dir"; }

scratch="$(fusion_mk_scratch agy)"
trap 'fusion_rm_scratch "$scratch"' EXIT
: > "$out_file"

# MetaLoop fast worker: snapshot the repo into <scratch>/work so the worker can
# READ the real codebase (proposal mode — edits land only in this disposable
# copy). Two concurrent agy sessions each get their own unique scratch + project,
# so they never collide. Blind panel mode passes no repo → empty work dir.
work="$scratch/work"; mkdir -p "$work"
repo="$(fusion_worker_repo "${5:-}")"
[ -n "$repo" ] && fusion_snapshot_repo "$repo" "$work" >/dev/null 2>&1 || true

win_work="$(fusion_winpath "$work")"
log="$scratch/stream.log"
# E2BIG-safe: small prompts inline, large prompts become work/.fusion-task.md.
prompt_text="$(fusion_prompt_text "$prompt_file" "$work")"

# Assemble optional flags only when the installed CLI advertises them, so an
# older/newer agy doesn't choke on an unknown flag. --new-project isolates the
# session so parallel agy workers do not share state.
opt_args=("$PRINT_FLAG" "$prompt_text" "$MODEL_FLAG" "$model")
have_flag -- '--print-timeout' && opt_args+=(--print-timeout "${timeout_s}s")
have_flag -- '--new-project'    && opt_args+=(--new-project)
opt_args+=("$DIR_FLAG" "$win_work")
have_flag -- '--dangerously-skip-permissions' && opt_args+=(--dangerously-skip-permissions)

_run() {
  agy "${opt_args[@]}" > "$out_file" 2> "$log"
}

fusion_timeout "$timeout_s" _run
rc=$?

if [ "$rc" -eq 124 ]; then
  echo "[fusion] agy timed out after ${timeout_s}s" >&2
  exit 124
fi
# A whitespace-only reply must never merge as a real worker (absent != agreement).
grep -q '[^[:space:]]' "$out_file" 2>/dev/null || : > "$out_file"
if [ "$rc" -ne 0 ] || [ ! -s "$out_file" ]; then
  fusion_fail "agy" "$rc" "$log"
  exit 1
fi
fusion_clean_output "$out_file"
exit 0
