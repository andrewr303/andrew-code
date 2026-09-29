#!/usr/bin/env bash
# fusion/scripts/providers/fable.sh — MetaLoop Main Planner / Board Advisor adapter (Fable 5.1 via Claude Code print mode).
#
# Usage: fable.sh <prompt_file> <out_file> [model] [effort] [workspace]
#
# Fable 5.1 is the Main Planner & Board Advisor: it frames every run (strategy,
# decomposition, risk, taste) and creates the master architectural plan.
# This adapter runs Claude Code in read-only print mode:
#   - prompt is fed on STDIN (never interpolated into argv -> injection-safe);
#   - NO --dangerously-skip-permissions (print mode auto-denies tool permissions);
#   - MCP disabled and write/exec tools disallowed where the installed CLI
#     supports the flags (capability-detected, not assumed);
#   - runs in an empty scratch cwd so it has no repo to touch.
# Same exit-code contract as every Fusion adapter (0/124/127/1).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=_common.sh
. "$DIR/_common.sh"

prompt_file="${1:?usage: fable.sh <prompt_file> <out_file> [model] [effort]}"
out_file="${2:?missing out_file}"
model="${3:-${FUSION_FABLE_MODEL:-fable-5.1}}"
effort="${4:-${FUSION_FABLE_EFFORT:-xhigh}}"
timeout_s="${FUSION_FABLE_TIMEOUT:-900}"

command -v claude >/dev/null 2>&1 || { echo "[fusion] claude CLI (for Fable planner) not installed" >&2; exit 127; }

scratch="$(fusion_mk_scratch fable)"
trap 'fusion_rm_scratch "$scratch"' EXIT
: > "$out_file"

win_scratch="$(fusion_winpath "$scratch")"
log="$scratch/stream.log"

# --- capability detection (only pass flags the installed claude advertises) --
help_text="$(claude --help 2>&1 || true)"
have_flag() { printf '%s' "$help_text" | grep -qE -- "$1"; }

claude_model="$model"
case "$claude_model" in
  fable*|Fable*) claude_model="fable" ;;
esac
opt_args=(--model "$claude_model")
have_flag -- '--output-format' && opt_args+=(--output-format text)
have_flag -- '--effort' && [ -n "$effort" ] && opt_args+=(--effort "$effort")

# Main Planner / CEO system prompt
ADVISOR_SYS="You are the Main Strategic Planner and Board Advisor for a Fusion MetaLoop run — the strategic authority that frames the run and establishes the architectural plan BEFORE work begins. You do not implement, dispatch workers, call tools, or edit files; you set direction and architectural specifications. Define the real outcome, the decomposition strategy, the risk priorities, and the quality/taste bar the Chief Operator (Codex) and worker agents (AndrewCode) must plan and execute against. Return ONLY one JSON object matching AdvisorMemo. 'decision' must be exactly one of: approve (proceed on the given plan), revise (proceed, but every required_changes item is a directive that MUST shape the plan), or stop (do not proceed). Put your directives in required_changes and decomposition_findings. Each risk_findings item should be an object with 'severity', 'finding', 'evidence', and 'consequence'. If context is insufficient, list missing_evidence rather than manufacturing certainty."
have_flag -- '--append-system-prompt' && opt_args+=(--append-system-prompt "$ADVISOR_SYS")
# Disable MCP + side-effect tools where supported (read-only advisor).
have_flag -- '--strict-mcp-config' && opt_args+=(--strict-mcp-config)
have_flag -- '--disallowedTools' && opt_args+=(--disallowedTools "Bash Edit Write MultiEdit NotebookEdit WebFetch")

_run() {
  ( cd "$win_scratch" 2>/dev/null || cd "$scratch"
    claude -p "${opt_args[@]}" < "$prompt_file" ) > "$out_file" 2> "$log"
}

fusion_timeout "$timeout_s" _run
rc=$?

if [ "$rc" -eq 124 ]; then
  echo "[fusion] fable (claude) timed out after ${timeout_s}s" >&2
  exit 124
fi
# Whitespace-only advice is not advice.
grep -q '[^[:space:]]' "$out_file" 2>/dev/null || : > "$out_file"
if [ "$rc" -ne 0 ] || [ ! -s "$out_file" ]; then
  fusion_fail "fable" "$rc" "$log"
  exit 1
fi
fusion_clean_output "$out_file"
exit 0