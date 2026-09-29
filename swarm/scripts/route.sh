#!/usr/bin/env bash
# fusion/scripts/route.sh — the mode advisor.
#
# IMPORTANT: this is ADVISORY, not the decider. Fusion is dynamic: the Conductor
# (Codex) reads the task and makes the final call on collaboration mode. This
# script gives the Conductor a fast, deterministic DEFAULT plus the ledger
# evidence, so the decision is grounded — never a rigid pipeline.
#
# Heuristics reconcile the source routers:
#   - openfusion router.py: FUSE-vs-SOLO gate + tier by code-fence / keywords / length
#   - nexus adaptive-router: capability scoring
#   - the empirical priors in lessons.md (vote for verifiable, panel for tool-using research)
#
# Usage:
#   route.sh "<task text>"      # or pipe the task on stdin
# Emits a small key=value block the Conductor parses.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LEDGER="$DIR/ledger.sh"

task="${1:-}"
[ -z "$task" ] && task="$(cat 2>/dev/null || true)"
low="$(printf '%s' "$task" | tr '[:upper:]' '[:lower:]')"
len=${#task}

has() { printf '%s' "$low" | grep -qE "$1"; }

# --- signals ----------------------------------------------------------------
code_signal=0
has '```|def |function |class |refactor|implement|fix (the )?bug|write (a|the|some)|build (a|an|the)|debug|stack ?trace|compile|unit test|migrat' && code_signal=1
verifiable_signal=0
has 'calculate|how many|what is the (value|result|sum|total)|solve|compute|convert |\bvalue of\b' && verifiable_signal=1
deliberate_signal=0
has 'compare|contrast|tradeoff|trade-off|pros and cons|should (we|i)|which (is|one)|evaluate|architecture|design decision|strategy|decide|recommend|vs\.?|versus|best approach' && deliberate_signal=1
debate_signal=0
has 'either|or should|a or b|for and against|argue|debate|opposing|two options|this or that' && debate_signal=1
large_signal=0
has 'across (the|all|multiple)|every file|whole (codebase|repo)|each of|in parallel|many files|migrate (the|all)' && large_signal=1
graph_signal=0
has 'knowledge graph|graphrag|graph rag|graph engineering|graph memory|task graph|ontolog|entity resolution|typed edges|multi-?hop|\bdag\b|fan.?out and|as a graph|loop until dry' && graph_signal=1
ureview_signal=0
has 'ultimate review|ureview|review (the |my )?plan|plan review|check the plan|review before|plan then (build|implement)|get it right the first time|no round.?trips|without asking me' && ureview_signal=1

# --- decide default mode + task_type ---------------------------------------
mode="panel"; task_type="research"; reason=""
# ureview is checked first: its triggers are an explicit request for the mode, and a short
# phrase like "review my plan" would otherwise be swallowed by the solo length gate below.
if [ "$ureview_signal" -eq 1 ]; then
  mode="ureview"; task_type="ureview"
  reason="plan-first build with cross-model gates — audit the plan before code exists, then auto-review the implementation"
elif [ "$len" -lt 120 ] && [ "$code_signal" -eq 0 ] && [ "$deliberate_signal" -eq 0 ] && [ "$verifiable_signal" -eq 0 ] && [ "$debate_signal" -eq 0 ]; then
  mode="solo"; task_type="quick"
  reason="short, single-answer prompt — fusion would not earn its cost; answer solo"
elif [ "$verifiable_signal" -eq 1 ] && [ "$len" -lt 400 ]; then
  mode="vote"; task_type="verifiable"
  reason="checkable single-value answer — model-free majority vote is cheap and accurate"
elif [ "$debate_signal" -eq 1 ]; then
  mode="debate"; task_type="decision"
  reason="a contested either/or — two sides + adjudication surfaces the real tradeoff"
elif [ "$graph_signal" -eq 1 ]; then
  mode="graph"; task_type="graph"
  reason="the structure is the problem — design it as a typed-node graph (or graph memory); plan it free with --plan first"
elif [ "$deliberate_signal" -eq 1 ]; then
  mode="council"; task_type="decision"
  reason="high-stakes open decision — multi-round council with anti-conformity beats one pass"
elif [ "$code_signal" -eq 1 ] && [ "$large_signal" -eq 1 ]; then
  mode="swarm"; task_type="code"
  reason="large/parallelizable build — decompose and fan subtasks across panelists"
elif [ "$code_signal" -eq 1 ]; then
  mode="panel"; task_type="code"
  reason="code task — panel each produces a candidate; judge runs+merges what works (Track A)"
else
  mode="panel"; task_type="research"
  reason="open-ended research — diverse tool-using panel + 5-section synthesis"
fi

# --- ledger evidence (override-by-history is the Conductor's call) -----------
host="${FUSION_HOST:-claude}"  # ~/.claude install: Claude Code is the host
panel="codex,copilot,opencode,grok"
[ "$host" = "codex" ] && panel="copilot,opencode,grok"

evidence="none yet"
if [ -x "$LEDGER" ] || [ -f "$LEDGER" ]; then
  win="$(bash "$LEDGER" winners "$task_type" 2>/dev/null | grep -v '^#' | head -1 || true)"
  board="$(bash "$LEDGER" leaderboard "$task_type" 2>/dev/null | sed -n '2p' || true)"
  [ -n "$win" ] && evidence="historical: ${win} | top panelist: ${board:-n/a}"
fi

cat <<EOF
MODE=$mode
TASK_TYPE=$task_type
REASON=$reason
PANEL=$panel
SIGNALS=code:$code_signal verifiable:$verifiable_signal deliberate:$deliberate_signal debate:$debate_signal large:$large_signal graph:$graph_signal ureview:$ureview_signal len:$len
LEDGER=$evidence
NOTE=advisory default — the Conductor may override based on task nuance + LEDGER
EOF
