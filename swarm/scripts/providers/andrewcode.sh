#!/usr/bin/env bash
# fusion/scripts/providers/andrewcode.sh — worker adapter for AndrewCode CLI (meta/muse-spark-1.3-contributor)
#
# Usage: andrewcode.sh <prompt_file> <out_file> [model] [effort] [workspace]
# Verified against andrewcode (Kimi Code v2 engine):
#   andrewcode -p "<text>" -m <provider/model> --output-format text
#
# Non-interactive one-shot worker execution:
#   * `-p/--prompt` is the non-interactive one-shot mode.
#   * Model defaults to meta/muse-spark-1.3-contributor with xhigh reasoning.
#   * Workspace is snapshot-backed in proposal mode (never writes real checkout directly).
#   * Presentation bullets ('• ') and session resumption lines are cleanly stripped.
#   * FUSION_ANDREWCODE_AUTO=1 appends `--auto -y` for unattended nested hive workers.
#   * Hive identity env (FUSION_BOARD, FUSION_AGENT_ID) is forwarded, never stripped.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
. "$DIR/_common.sh"

prompt_file="${1:?usage: andrewcode.sh <prompt_file> <out_file> [model] [effort] [workspace]}"
out_file="${2:?missing out_file}"
model="${3:-${FUSION_ANDREWCODE_MODEL:-meta/muse-spark-1.3-contributor}}"
effort="${4:-${FUSION_ANDREWCODE_EFFORT:-xhigh}}"
timeout_s="${FUSION_ANDREWCODE_TIMEOUT:-900}"

# Hive nested workers inherit board identity. Re-export if set; never unset/strip.
[ -n "${FUSION_BOARD:-}" ] && export FUSION_BOARD
[ -n "${FUSION_AGENT_ID:-}" ] && export FUSION_AGENT_ID
[ -n "${FUSION_PARENT_ID:-}" ] && export FUSION_PARENT_ID
[ -n "${FUSION_SWARM_ID:-}" ] && export FUSION_SWARM_ID

command -v andrewcode >/dev/null 2>&1 || { echo "[fusion] andrewcode not installed" >&2; exit 127; }

scratch="$(fusion_mk_scratch andrewcode)"
trap 'fusion_rm_scratch "$scratch"' EXIT
: > "$out_file"

work="$scratch/work"; mkdir -p "$work"
repo="$(fusion_worker_repo "${5:-}")"
[ -n "$repo" ] && fusion_snapshot_repo "$repo" "$work" >/dev/null 2>&1 || true

raw="$scratch/raw.out"
log="$scratch/stream.log"
prompt_text="$(fusion_prompt_text "$prompt_file" "$work")"

# Unattended nested hive: --auto -y. Off unless FUSION_ANDREWCODE_AUTO=1
# (defaults.env sets this; an explicit 0/empty keeps the historical prompt-only argv).
_run() {
  ( cd "$work" 2>/dev/null || cd "$scratch"
    if [ "${FUSION_ANDREWCODE_AUTO:-0}" = "1" ]; then
      andrewcode \
        -p "$prompt_text" \
        -m "$model" \
        --auto -y \
        --output-format text
    else
      andrewcode \
        -p "$prompt_text" \
        -m "$model" \
        --output-format text
    fi ) > "$raw" 2> "$log"
}

fusion_timeout "$timeout_s" _run
rc=$?

cp "$log" "${out_file}.log" 2>/dev/null || true
cp "$raw" "${out_file}.raw" 2>/dev/null || true

if [ "$rc" -eq 124 ]; then
  echo "[fusion] andrewcode timed out after ${timeout_s}s" >&2
  exit 124
fi

if [ -s "$raw" ]; then
  sed -e '/^To resume this session:/,$d' \
      -e '/^kimi version/d' \
      -e '/^andrewcode version/d' \
      -e 's/^• //' \
      "$raw" > "$out_file" 2>/dev/null || cp "$raw" "$out_file" 2>/dev/null || true
fi

grep -q '[^[:space:]]' "$out_file" 2>/dev/null || : > "$out_file"

if [ "$rc" -ne 0 ] || [ ! -s "$out_file" ]; then
  fusion_fail "andrewcode" "$rc" "$log"
  exit 1
fi
fusion_clean_output "$out_file"
exit 0