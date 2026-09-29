#!/usr/bin/env bash
# fusion/scripts/providers/codex.sh — panelist adapter for OpenAI Codex (gpt-5.5)
#
# Usage: codex.sh <prompt_file> <out_file> [model] [effort] [sandbox] [workspace]
# Verified against codex-cli 0.141.0:
#   codex exec --skip-git-repo-check -C <dir> -s <sandbox> -m <model>
#              -c 'web_search="live"' -c model_reasoning_effort=<effort>
#              -o <out> -            (prompt read from stdin)
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
. "$DIR/_common.sh"

prompt_file="${1:?usage: codex.sh <prompt_file> <out_file> [model] [effort] [sandbox]}"
out_file="${2:?missing out_file}"
model="${3:-${FUSION_CODEX_MODEL:-gpt-5.6-sol}}"
effort="${4:-${FUSION_CODEX_EFFORT:-xhigh}}"
sandbox="${5:-${FUSION_CODEX_SANDBOX:-workspace-write}}"
timeout_s="${FUSION_CODEX_TIMEOUT:-900}"

command -v codex >/dev/null 2>&1 || { echo "[fusion] codex not installed" >&2; exit 127; }

scratch="$(fusion_mk_scratch codex)"
trap 'fusion_rm_scratch "$scratch"' EXIT
: > "$out_file"

# MetaLoop Chief Operator / worker: snapshot the repo into <scratch>/work so
# codex can READ the real codebase (proposal mode - edits land only in this
# disposable copy). Blind mode passes no repo and work stays empty.
work="$scratch/work"; mkdir -p "$work"
repo="$(fusion_worker_repo "${6:-}")"
[ -n "$repo" ] && fusion_snapshot_repo "$repo" "$work" >/dev/null 2>&1 || true

win_work="$(fusion_winpath "$work")"
win_out="$(fusion_winpath "$out_file")"
log="$scratch/stream.log"

_run() {
  codex exec \
    --skip-git-repo-check \
    --ephemeral \
    --color never \
    -C "$win_work" \
    -s "$sandbox" \
    -m "$model" \
    -c 'web_search="live"' \
    -c "model_reasoning_effort=$effort" \
    -o "$win_out" \
    - < "$prompt_file" > "$log" 2>&1
}

fusion_timeout "$timeout_s" _run
rc=$?
# Preserve the stream log beside the out file - the scratch dir is deleted on
# exit, and silent partial outputs are undiagnosable without it.
cp "$log" "${out_file}.log" 2>/dev/null || true

if [ "$rc" -eq 124 ]; then
  echo "[fusion] codex timed out after ${timeout_s}s" >&2
  exit 124
fi
if [ "$rc" -ne 0 ] || [ ! -s "$out_file" ]; then
  fusion_fail "codex" "$rc" "$log"
  exit 1
fi
fusion_clean_output "$out_file"
exit 0
