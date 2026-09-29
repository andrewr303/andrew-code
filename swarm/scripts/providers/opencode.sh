#!/usr/bin/env bash
# fusion/scripts/providers/opencode.sh — panelist adapter for OpenCode (glm-5.2)
#
# Usage: opencode.sh <prompt_file> <out_file> [model] [variant]
# Verified against opencode 1.17.9 (model id confirmed present: opencode-go/glm-5.2):
#   opencode run -m <provider/model> --variant <effort> --format json --dir <dir> "<text>"
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
. "$DIR/_common.sh"

prompt_file="${1:?usage: opencode.sh <prompt_file> <out_file> [model] [variant] [workspace]}"
out_file="${2:?missing out_file}"
model="${3:-${FUSION_OPENCODE_MODEL:-opencode-go/glm-5.2}}"
variant="${4:-${FUSION_OPENCODE_VARIANT:-high}}"
timeout_s="${FUSION_OPENCODE_TIMEOUT:-600}"

command -v opencode >/dev/null 2>&1 || { echo "[fusion] opencode not installed" >&2; exit 127; }

scratch="$(fusion_mk_scratch opencode)"
trap 'fusion_rm_scratch "$scratch"' EXIT
: > "$out_file"

# The worker runs inside <scratch>/work; fusion's own bookkeeping (raw/log) stays
# in the scratch root so the model never sees it. As a MetaLoop worker, `work` is
# populated with a snapshot of the repo so the worker can READ the real codebase
# (proposal mode — it edits only this disposable copy). Blind panel mode passes
# no repo and `work` stays empty (unchanged behaviour).
work="$scratch/work"; mkdir -p "$work"
repo="$(fusion_worker_repo "${5:-}")"
[ -n "$repo" ] && fusion_snapshot_repo "$repo" "$work" >/dev/null 2>&1 || true

win_work="$(fusion_winpath "$work")"
raw="$scratch/raw.out"
log="$scratch/stream.log"
# E2BIG-safe: small prompts inline, large prompts become work/.fusion-task.md.
prompt_text="$(fusion_prompt_text "$prompt_file" "$work")"

_run() {
  opencode run \
    -m "$model" \
    --variant "$variant" \
    --format json \
    --dir "$win_work" \
    "$prompt_text" > "$raw" 2> "$log"
}

fusion_timeout "$timeout_s" _run
rc=$?
# Preserve diagnostics past scratch cleanup: opencode can exit 0 with a partial
# stream (observed live: narration-only output with no final answer), and the
# raw event stream + stderr are the only way to diagnose it after the fact.
cp "$log" "${out_file}.log" 2>/dev/null || true
cp "$raw" "${out_file}.raw" 2>/dev/null || true

if [ "$rc" -eq 124 ]; then
  echo "[fusion] opencode timed out after ${timeout_s}s" >&2
  exit 124
fi

# --format json emits JSON events; extract assistant text. Fall back to raw if parse fails.
if [ -s "$raw" ]; then
  if command -v jq >/dev/null 2>&1; then
    # Concatenate any text parts across message events; tolerant of shape drift.
    jq -rs '
      [ .[]
        | (.. | objects | select(has("text")) | .text? // empty) ]
      | map(select(type=="string")) | join("")
    ' "$raw" > "$out_file" 2>/dev/null || true
  fi
  # If jq produced nothing usable, fall back to the raw stream (last resort).
  if [ ! -s "$out_file" ]; then
    cp "$raw" "$out_file" 2>/dev/null || true
  fi
fi
# Heuristic truncation warning: a worker reply that never reaches a JSON object
# usually means the CLI died mid-run while exiting 0 (observed live twice).
if [ -s "$out_file" ] && ! grep -q "{" "$out_file"; then
  echo "[fusion] warning: opencode output contains no JSON object - possible mid-run truncation (see ${out_file}.raw)" >&2
fi

# A text-less / tool-only JSON stream makes jq's empty join() write a bare
# newline, which would pass [ -s ] and silently merge a BLANK panelist into
# consensus (violating absent != agreement). Treat whitespace-only as empty.
grep -q '[^[:space:]]' "$out_file" 2>/dev/null || : > "$out_file"

if [ "$rc" -ne 0 ] || [ ! -s "$out_file" ]; then
  fusion_fail "opencode" "$rc" "$log"
  exit 1
fi
fusion_clean_output "$out_file"
exit 0
