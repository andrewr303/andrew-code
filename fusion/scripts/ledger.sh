#!/usr/bin/env bash
# fusion/scripts/ledger.sh — Fusion's self-learning memory.
#
# Records every run, then turns that history into guidance for the next run.
# Two feedback halves, reconciled from the source repos:
#   - OPERATIONAL (octopus intelligence.sh): per-provider reliability via a
#     Bayesian-smoothed success rate + a fairness floor so new providers keep
#     getting sampled.
#   - QUALITATIVE (nexus performance-tracker / embedding-similarity): which
#     panelist actually *won* (led the synthesis / topped the ranking / carried
#     the vote), bucketed by task type — so routing can prefer who tends to win
#     on tasks like this one.
#
# Storage (plain files, no DB — greppable, diffable, user-inspectable):
#   memory/runs.jsonl        append-only run records (one JSON object per line)
#   memory/lessons.md        derived: distilled, human+model-readable guidance
#
# Usage:
#   ledger.sh record '<json>'         append a run record (validated)
#   ledger.sh score <provider>        print Bayesian reliability score [0..1]
#   ledger.sh rank                    provider ranking (score, fairness floor)
#   ledger.sh leaderboard [task_type] qualitative win-rates (overall or by type)
#   ledger.sh winners <task_type>     best (mode, panel) for a task type
#   ledger.sh mark-degraded <prov>    mark a provider quota/auth-dead this session
#   ledger.sh clear-degraded          clear the session degraded list
#   ledger.sh lessons                 regenerate memory/lessons.md
#   ledger.sh stats                   one-screen summary
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUSION_ROOT="$(cd "$DIR/.." && pwd)"
# Live store defaults to the USER dir so it survives plugin updates and works when
# the installed plugin dir is read-only. The plugin ships a seed at
# $FUSION_ROOT/memory which is copied in on first use.
STATE_DIR="${FUSION_STATE_DIR:-$HOME/.fusion}"
MEM_DIR="${FUSION_MEMORY_DIR:-$STATE_DIR/memory}"
RUNS="$MEM_DIR/runs.jsonl"
LESSONS="$MEM_DIR/lessons.md"
DEGRADED_FILE="$STATE_DIR/degraded-providers"
SEED_DIR="$FUSION_ROOT/memory"

mkdir -p "$MEM_DIR" "$STATE_DIR" 2>/dev/null || true
# seed lessons from the shipped copy on first use (never overwrite a live one)
[ -f "$LESSONS" ] || { [ -f "$SEED_DIR/lessons.md" ] && cp "$SEED_DIR/lessons.md" "$LESSONS" 2>/dev/null; }
[ -f "$RUNS" ] || : > "$RUNS"

HAVE_JQ=0
command -v jq >/dev/null 2>&1 && HAVE_JQ=1

_need_jq() {
  if [ "$HAVE_JQ" -eq 0 ]; then
    echo "[fusion] ledger: jq not found — '$1' needs jq. Install jq for full learning." >&2
    return 1
  fi
}

# ---- record ----------------------------------------------------------------
cmd_record() {
  local json="${1:?usage: ledger.sh record '<json>'}"
  if [ "$HAVE_JQ" -eq 1 ]; then
    if ! printf '%s' "$json" | jq -e 'type=="object"' >/dev/null 2>&1; then
      echo "[fusion] ledger: record rejected — must be a JSON object" >&2
      return 1
    fi
    printf '%s\n' "$(printf '%s' "$json" | jq -c .)" >> "$RUNS"
  else
    printf '%s\n' "$(printf '%s' "$json" | tr -d '\n')" >> "$RUNS"
  fi
  if [ "$(wc -l < "$RUNS" 2>/dev/null || echo 0)" -gt 2000 ]; then
    tail -n 2000 "$RUNS" > "$RUNS.tmp" && mv "$RUNS.tmp" "$RUNS"
  fi
}

# successes/failures per provider from panelist status fields
# success = status=="returned"; failure = absent|fallback|timeout|error
_counts() {
  local prov="$1"
  if [ "$HAVE_JQ" -eq 0 ]; then echo "0 0"; return; fi
  jq -r --arg p "$prov" '.panelists[]? | select(.provider==$p) | .status' "$RUNS" 2>/dev/null \
  | awk '
      /^returned$/ {s++}
      /^(absent|fallback|timeout|error)$/ {f++}
      END { printf "%d %d\n", s+0, f+0 }'
}

# ---- score (Bayesian reliability) ------------------------------------------
cmd_score() {
  local prov="${1:?usage: ledger.sh score <provider>}"
  read -r s f <<<"$(_counts "$prov")"
  # (successes + 3.5) / (successes + failures + 5)  → prior 0.7, weight 5
  awk -v s="$s" -v f="$f" 'BEGIN { printf "%.3f\n", (s + 3.5) / (s + f + 5) }'
}

# ---- rank (score + 5% fairness floor) --------------------------------------
cmd_rank() {
  local prov score samples s f
  for prov in codex copilot opencode grok agy fable; do
    read -r s f <<<"$(_counts "$prov")"
    samples=$((s + f))
    score="$(cmd_score "$prov")"
    # fairness floor: providers with <5 samples are boosted so they keep getting sampled
    if [ "$samples" -lt 5 ]; then score="0.990"; fi
    printf '%s\t%s\t%d\n' "$prov" "$score" "$samples"
  done | sort -t$'\t' -k2 -rn
}

# ---- qualitative leaderboard ------------------------------------------------
cmd_leaderboard() {
  _need_jq "leaderboard" || return 1
  local tt="${1:-}"
  echo "provider    wins   avg_rank"
  jq -rs --arg tt "$tt" '
    [ .[] | select($tt=="" or .task_type==$tt) ] as $runs
    | ["codex","copilot","opencode","grok","agy"]
    | map(. as $p
        | { provider: $p,
            wins: ( [ $runs[] | select(.winner==$p) ] | length ),
            avg_rank: ( [ $runs[].panelists[]? | select(.provider==$p and (.rank!=null)) | .rank ]
                        | if length>0 then ((add/length)*100|round/100) else null end ) })
    | sort_by(-.wins)[]
    | "\(.provider)\t\(.wins)\t\(.avg_rank // "-")"
  ' "$RUNS" 2>/dev/null \
    | awk -F'\t' '{ printf "%-10s  %-5s  %s\n", $1, $2, $3 }'
}

# ---- best (mode,panel) for a task type -------------------------------------
cmd_winners() {
  _need_jq "winners" || return 1
  local tt="${1:?usage: ledger.sh winners <task_type>}"
  echo "# best modes for task_type=$tt (by run count)"
  jq -rs --arg tt "$tt" '
    [ .[] | select(.task_type==$tt) ]
    | group_by(.mode)
    | map({ mode: .[0].mode, runs: length,
            avg_consensus: ( [ .[].consensus // empty ]
                             | if length>0 then ((add/length)*100|round/100) else null end) })
    | sort_by(-.runs)[]
    | "\(.runs) runs\tmode=\(.mode)\tavg_consensus=\(.avg_consensus // "-")"
  ' "$RUNS" 2>/dev/null
}

# ---- degraded state ---------------------------------------------------------
cmd_mark_degraded() {
  local prov="${1:?usage: ledger.sh mark-degraded <provider>}"
  touch "$DEGRADED_FILE"
  grep -qxF "$prov" "$DEGRADED_FILE" 2>/dev/null || echo "$prov" >> "$DEGRADED_FILE"
  echo "[fusion] marked '$prov' degraded for this session"
}
cmd_clear_degraded() { : > "$DEGRADED_FILE" 2>/dev/null || true; echo "[fusion] cleared degraded providers"; }

# ---- lessons (distilled guidance) ------------------------------------------
cmd_lessons() {
  local total; total="$(wc -l < "$RUNS" 2>/dev/null || echo 0)"
  local prior_block
  if [ -f "$LESSONS" ] && grep -q '<!-- FUSION:PRIORS -->' "$LESSONS"; then
    prior_block="$(sed -n '/<!-- FUSION:PRIORS -->/,$p' "$LESSONS" | tail -n +2)"
  else
    prior_block="$(cat <<'PRIORS'

## Seed priors (from the Fusion research — keep until data overrides)

- **Fusion earns its cost on open-ended / tool-using tasks, not saturated short ones.**
  On tool-free tasks a strong judge can *dilute* the best single answer
  (openfusion FINDINGS: ~29% judge win-rate without tools). Always give panelists
  real tools (web + shell), and prefer `solo` for trivial/verifiable prompts.
- **Diversity must be real model families.** codex(OpenAI) · copilot(Google) ·
  opencode(GLM) · grok(xAI) take different search trajectories → complementary
  evidence the judge can fuse. Same-family panels regurgitate.
- **Vote ≥ judge on verifiable/math at near-zero cost.** Use `vote` when the answer
  is a checkable value; use `ranked` when synthesis would blend away the best answer.
- **Synthesis itself adds ~6.7 pts** even self-fusing one model — the merge step is
  where a real chunk of the lift comes from, not just model count.
- **Absent ≠ agreement.** A dropped/failed panelist must never be counted as endorsing
  the survivors; recompute consensus over returning members only.
PRIORS
)"
  fi
  {
    echo "# Fusion — Lessons Learned"
    echo ""
    echo "> Auto-generated by \`ledger.sh lessons\`. The Conductor reads this before routing."
    echo "> Runs recorded: ${total}. Hand-written priors below the divider are preserved."
    echo ""
    echo "## Provider reliability (Bayesian, prior 0.7)"
    echo ""
    echo "| provider | reliability | samples |"
    echo "|----------|-------------|---------|"
    local prov s f
    for prov in codex copilot opencode grok agy fable; do
      read -r s f <<<"$(_counts "$prov")"
      printf "| %s | %s | %d |\n" "$prov" "$(cmd_score "$prov")" "$((s+f))"
    done
    echo ""
    if [ "$HAVE_JQ" -eq 1 ] && [ "$total" -gt 0 ]; then
      echo "## Qualitative win-rates (who tends to win)"
      echo ""
      echo '```'
      cmd_leaderboard
      echo '```'
      echo ""
      echo "## Best mode by task type"
      echo ""
      local tt
      while IFS= read -r tt; do
        [ -z "$tt" ] && continue
        echo "- **$tt**:"
        cmd_winners "$tt" 2>/dev/null | grep -v '^#' | sed 's/^/    - /'
      done < <(jq -r '.task_type' "$RUNS" 2>/dev/null | sort -u | grep -v '^null$' | grep -v '^$')
      echo ""
    fi
    echo "<!-- FUSION:PRIORS -->"
    printf '%s\n' "$prior_block"
  } > "$LESSONS.tmp" && mv "$LESSONS.tmp" "$LESSONS"
  echo "[fusion] wrote $LESSONS"
}

# ---- stats ------------------------------------------------------------------
cmd_stats() {
  local total; total="$(wc -l < "$RUNS" 2>/dev/null || echo 0)"
  echo "Fusion ledger — $total runs recorded"
  echo ""
  echo "Provider reliability + fairness rank:"
  cmd_rank | awk -F'\t' '{ printf "  %-10s score=%-6s samples=%s\n", $1, $2, $3 }'
  if [ "$HAVE_JQ" -eq 1 ] && [ "$total" -gt 0 ]; then
    echo ""
    echo "Mode usage:"
    jq -r '.mode' "$RUNS" 2>/dev/null | sort | uniq -c | sort -rn | awk '{ printf "  %s  %s\n", $1, $2 }'
  fi
}

case "${1:-}" in
  record)         shift; cmd_record "$@";;
  score)          shift; cmd_score "$@";;
  rank)           shift; cmd_rank "$@";;
  leaderboard)    shift; cmd_leaderboard "$@";;
  winners)        shift; cmd_winners "$@";;
  mark-degraded)  shift; cmd_mark_degraded "$@";;
  clear-degraded) shift; cmd_clear_degraded "$@";;
  lessons)        shift; cmd_lessons "$@";;
  show-lessons)   shift; [ -s "$LESSONS" ] || cmd_lessons >/dev/null 2>&1; cat "$LESSONS" 2>/dev/null;;
  path)           shift; echo "$MEM_DIR";;
  stats)          shift; cmd_stats "$@";;
  *) echo "usage: ledger.sh {record|score|rank|leaderboard|winners|mark-degraded|clear-degraded|lessons|show-lessons|path|stats}" >&2; exit 2;;
esac
