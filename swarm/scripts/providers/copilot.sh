#!/usr/bin/env bash
# fusion/scripts/providers/copilot.sh — panelist adapter for GitHub Copilot CLI (gemini-3.5-flash)
#
# Usage: copilot.sh <prompt_file> <out_file> [model]
# Verified against GitHub Copilot CLI 1.0.64:
#   copilot -p "<text>" --model <model> --allow-all-tools -s --no-color -C <dir>
#     -p/--prompt   non-interactive prompt
#     --model       AI model (gemini-3.5-flash)
#     --allow-all-tools  required for non-interactive
#     -s/--silent   output ONLY the agent response (clean capture)
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
. "$DIR/_common.sh"

prompt_file="${1:?usage: copilot.sh <prompt_file> <out_file> [model]}"
out_file="${2:?missing out_file}"
model="${3:-${FUSION_COPILOT_MODEL:-gemini-3.5-flash}}"
timeout_s="${FUSION_COPILOT_TIMEOUT:-600}"

command -v copilot >/dev/null 2>&1 || { echo "[fusion] copilot not installed" >&2; exit 127; }

scratch="$(fusion_mk_scratch copilot)"
trap 'fusion_rm_scratch "$scratch"' EXIT
: > "$out_file"

# Runs in <scratch>/work. If invoked as a MetaLoop worker (repo passed) the work
# dir is populated with a repo snapshot for READ access; blind panel mode leaves
# it empty (unchanged behaviour).
work="$scratch/work"; mkdir -p "$work"
repo="$(fusion_worker_repo "${5:-}")"
[ -n "$repo" ] && fusion_snapshot_repo "$repo" "$work" >/dev/null 2>&1 || true

win_work="$(fusion_winpath "$work")"
log="$scratch/stream.log"
# E2BIG-safe: small prompts inline, large prompts become work/.fusion-task.md.
prompt_text="$(fusion_prompt_text "$prompt_file" "$work")"

# Optional reasoning-effort (Copilot CLI >=1.0.64 supports --reasoning-effort).
# Passed as dispatch arg 4 or FUSION_COPILOT_EFFORT; only applied when non-empty
# and a valid choice, so default behaviour is unchanged when unset.
effort="${4:-${FUSION_COPILOT_EFFORT:-}}"
effort_args=()
case "$effort" in
  none|minimal|low|medium|high|xhigh|max) effort_args=(--reasoning-effort "$effort");;
  "") : ;;
  *) echo "[fusion] copilot: ignoring unknown reasoning-effort '$effort'" >&2 ;;
esac

_run() {
  copilot \
    -p "$prompt_text" \
    --model "$model" \
    "${effort_args[@]}" \
    --allow-all-tools \
    --no-color \
    -s \
    -C "$win_work" > "$out_file" 2> "$log"
}

fusion_timeout "$timeout_s" _run
rc=$?

if [ "$rc" -eq 124 ]; then
  echo "[fusion] copilot timed out after ${timeout_s}s" >&2
  exit 124
fi
if [ "$rc" -ne 0 ] || [ ! -s "$out_file" ]; then
  fusion_fail "copilot" "$rc" "$log"
  exit 1
fi
fusion_clean_output "$out_file"
exit 0
