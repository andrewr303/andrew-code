#!/usr/bin/env bash
# fusion/scripts/providers/kimi.sh — panelist adapter for Kimi Code CLI (azure/kimi-k3)
#
# Usage: kimi.sh <prompt_file> <out_file> [model] [effort] [workspace]
# Verified against kimi-code 0.30.0:
#   kimi -p "<text>" -m <provider/model> --output-format text --auto
#
# Notes on the CLI's shape (why this adapter looks the way it does):
#   * `-p/--prompt` is the non-interactive one-shot mode; without it the CLI
#     starts a TUI and would hang forever behind fusion_timeout.
#   * `-p` is MUTUALLY EXCLUSIVE with both `--auto` and `--yolo` (verified live:
#     "error: Cannot combine --prompt with --auto"). Prompt mode is already
#     one-shot and unattended, so neither flag is needed — do not re-add them.
#   * There is NO `--dir`/`-C` flag. The workspace is the process cwd, so the
#     snapshot is entered with `cd` before invoking. `--add-dir` only ADDS a
#     directory, it does not relocate the root.
#   * `--output-format text` prints the response on stdout directly, so unlike
#     opencode there is no JSON event stream to unwrap.
#   * Kimi has no reasoning-effort flag; the `effort` positional is accepted and
#     ignored so the adapter stays signature-compatible with the dispatcher.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
. "$DIR/_common.sh"

prompt_file="${1:?usage: kimi.sh <prompt_file> <out_file> [model] [effort] [workspace]}"
out_file="${2:?missing out_file}"
model="${3:-${FUSION_KIMI_MODEL:-azure/kimi-k3}}"
# shellcheck disable=SC2034  # accepted for signature compatibility; kimi has no effort knob
effort="${4:-}"
timeout_s="${FUSION_KIMI_TIMEOUT:-900}"

command -v kimi >/dev/null 2>&1 || { echo "[fusion] kimi not installed" >&2; exit 127; }

scratch="$(fusion_mk_scratch kimi)"
trap 'fusion_rm_scratch "$scratch"' EXIT
: > "$out_file"

# The worker runs inside <scratch>/work; fusion's bookkeeping (raw/log) stays in
# the scratch root so the model never sees it. As a worker, `work` is populated
# with a snapshot of the repo so it can READ the real codebase (proposal mode —
# it edits only this disposable copy). Blind panel mode leaves `work` empty.
work="$scratch/work"; mkdir -p "$work"
repo="$(fusion_worker_repo "${5:-}")"
[ -n "$repo" ] && fusion_snapshot_repo "$repo" "$work" >/dev/null 2>&1 || true

raw="$scratch/raw.out"
log="$scratch/stream.log"
# E2BIG-safe: small prompts inline, large prompts become work/.fusion-task.md.
prompt_text="$(fusion_prompt_text "$prompt_file" "$work")"

# No --dir flag: the workspace IS the cwd, so enter it in a subshell.
_run() {
  ( cd "$work" 2>/dev/null || cd "$scratch"
    kimi \
      -p "$prompt_text" \
      -m "$model" \
      --output-format text ) > "$raw" 2> "$log"
}

fusion_timeout "$timeout_s" _run
rc=$?
# Preserve diagnostics past scratch cleanup — a silent partial output is
# undiagnosable without the stream log.
cp "$log" "${out_file}.log" 2>/dev/null || true
cp "$raw" "${out_file}.raw" 2>/dev/null || true

if [ "$rc" -eq 124 ]; then
  echo "[fusion] kimi timed out after ${timeout_s}s" >&2
  exit 124
fi

# `--output-format text` wraps the reply in the CLI's presentation layer:
#   * every top-level line (narration AND answer) is prefixed with "• "
#   * continuation lines of the answer are indented two spaces
#   * a trailing "To resume this session: kimi -r session_..." footer
# Strip the bullet marker and the footer so downstream nodes get clean markdown.
# The two-space indent is deliberately LEFT ALONE: de-indenting blindly would
# collapse nested markdown lists, and an indented block reads fine to a model.
if [ -s "$raw" ]; then
  sed -e '/^To resume this session:/,$d' \
      -e 's/^• //' \
      "$raw" > "$out_file" 2>/dev/null || cp "$raw" "$out_file" 2>/dev/null || true
fi

# A whitespace-only reply would pass [ -s ] and silently merge a BLANK panelist
# into consensus, violating absent != agreement. Treat it as empty.
grep -q '[^[:space:]]' "$out_file" 2>/dev/null || : > "$out_file"

if [ "$rc" -ne 0 ] || [ ! -s "$out_file" ]; then
  fusion_fail "kimi" "$rc" "$log"
  exit 1
fi
fusion_clean_output "$out_file"
exit 0
