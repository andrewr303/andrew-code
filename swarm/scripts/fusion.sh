#!/usr/bin/env bash
# fusion/scripts/fusion.sh — the Fusion command surface (bash side).
#
# The Conductor (Codex) does all reasoning/judging/synthesis. This
# script owns the I/O-bound, deterministic plumbing: detect providers, dispatch
# one panelist, fan out a whole panel concurrently, advise a mode, and read/write
# the learning ledger. Nothing here decides the answer — it only moves bytes and
# keeps books, so the orchestration model stays in control.
#
# Verbs:
#   fusion.sh detect [--json]                provider availability (tri-state)
#   fusion.sh route "<task>"                 advisory mode + ledger evidence
#   fusion.sh dispatch <prov> <pf> <of> [m] [e] [ws]  run one panelist adapter
#       [ws] = a repo dir a MetaLoop worker should snapshot for READ context;
#              omit it (or set empty) for blind panel modes.
#   fusion.sh panel <pf> <out_dir> [csv]     fan out a panel concurrently, report status
#   fusion.sh huddle <pf> <out_dir> [csv]    panel advises on APPROACH before a mode is chosen
#   fusion.sh ledger <args...>               passthrough to ledger.sh
#   fusion.sh board <args...>                passthrough to board.sh (Hive Board CLI)
#   fusion.sh hive <args...>                 passthrough to hive.sh (nested hive runner)
#   fusion.sh providers                      list known panelists + defaults
#   fusion.sh version | help
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROV_DIR="$DIR/providers"
LEDGER="$DIR/ledger.sh"
ROUTE="$DIR/route.sh"
DETECT="$PROV_DIR/detect.sh"
BOARD="$DIR/board.sh"
HIVE="$DIR/hive.sh"
FUSION_VERSION="3.0.0"

# Host-recursion guard: never subprocess the CLI we are running *inside*.
# This install lives under ~/.claude (Claude Code is the host), so the default
# host is "claude" and codex is DISPATCHABLE — it serves as the MetaLoop Chief
# Operator (gpt-5.6-sol @ xhigh). Set FUSION_HOST=codex when running under the
# Codex CLI so codex is never subprocessed from inside itself.
FUSION_HOST="${FUSION_HOST:-claude}"

adapter_for() {
  case "$1" in
    codex)    echo "$PROV_DIR/codex.sh";;
    copilot)  echo "$PROV_DIR/copilot.sh";;
    opencode) echo "$PROV_DIR/opencode.sh";;
    grok)     echo "$PROV_DIR/grok.sh";;
    kimi)     echo "$PROV_DIR/kimi.sh";;
    andrewcode) echo "$PROV_DIR/andrewcode.sh";;
    # MetaLoop (fusion:metaloop) participants:
    agy)      echo "$PROV_DIR/agy.sh";;
    fable)    echo "$PROV_DIR/fable.sh";;
    *) return 1;;
  esac
}

live_providers() {
  bash "$DETECT" --json 2>/dev/null \
    | { command -v jq >/dev/null 2>&1 \
        && jq -r --arg host "$FUSION_HOST" '.providers | to_entries[] | select(.key!="claude" and .key!=$host and .value=="available") | .key' \
        || tr ',' '\n' | grep -oE '"(codex|copilot|opencode|grok|kimi|andrewcode)":"available"' | sed -E 's/"([a-z]+)":.*/\1/'; } \
    | tr -d '\r'   # jq on Windows appends CR; strip it or downstream provider matching breaks
}

cmd_dispatch() {
  local prov="${1:?usage: dispatch <provider> <prompt_file> <out_file> [model] [effort] [workspace]}"
  local pf="${2:?missing prompt_file}"; local of="${3:?missing out_file}"
  local model="${4:-}"; local effort="${5:-}"; local workspace="${6:-}"
  if [ "$prov" = "$FUSION_HOST" ]; then
    echo "[fusion] '$prov' is the host runtime — fold its view in-context, not as a subprocess." >&2
    return 3
  fi
  local adapter; adapter="$(adapter_for "$prov")" || { echo "[fusion] unknown provider '$prov'" >&2; return 2; }
  # A MetaLoop worker gets a repo to snapshot for READ context (proposal mode).
  # Pass it both positionally and via env so adapters can resolve either.
  [ -n "$workspace" ] && export FUSION_WORKER_REPO="$workspace"
  if [ "$prov" = "codex" ]; then
    # codex.sh has an extra positional (sandbox) before workspace: (pf, of,
    # model, effort, sandbox, workspace). Leave sandbox empty so the adapter
    # falls back to FUSION_CODEX_SANDBOX/default, and pass workspace at $6 —
    # otherwise workspace lands in the sandbox slot and corrupts --sandbox.
    bash "$adapter" "$pf" "$of" "$model" "$effort" "" "$workspace"
  else
    bash "$adapter" "$pf" "$of" "$model" "$effort" "$workspace"
  fi
}

# Fan out a panel concurrently. Each panelist writes to <out_dir>/<prov>.out.
# Prints a status line per provider and a manifest. Embodies absent≠agreement:
# a provider that fails/times out is reported absent, never silently merged.
cmd_panel() {
  local pf="${1:?usage: panel <prompt_file> <out_dir> [csv_providers]}"
  local out_dir="${2:?missing out_dir}"
  local csv="${3:-}"
  mkdir -p "$out_dir"

  local providers
  if [ -n "$csv" ]; then
    providers="$(printf '%s' "$csv" | tr ',\r' '  ')"
  else
    providers="$(live_providers | tr '\n' ' ')"
  fi

  local manifest="$out_dir/manifest.txt"; : > "$manifest"
  declare -A PID STATUSFILE START
  local prov
  for prov in $providers; do
    [ "$prov" = "$FUSION_HOST" ] && { echo "$prov:host-native" >> "$manifest"; continue; }
    adapter_for "$prov" >/dev/null 2>&1 || { echo "$prov:unknown" >> "$manifest"; continue; }
    local of="$out_dir/$prov.out"
    local sf="$out_dir/$prov.status"
    START[$prov]=$(date +%s)
    ( bash "$(adapter_for "$prov")" "$pf" "$of" >/dev/null 2>"$out_dir/$prov.log"; echo $? > "$sf" ) &
    PID[$prov]=$!
    STATUSFILE[$prov]="$sf"
  done

  # await all
  for prov in "${!PID[@]}"; do wait "${PID[$prov]}" 2>/dev/null || true; done

  # report
  for prov in $providers; do
    [ "$prov" = "$FUSION_HOST" ] && continue
    adapter_for "$prov" >/dev/null 2>&1 || continue
    local rc=1; [ -f "${STATUSFILE[$prov]:-}" ] && rc="$(cat "${STATUSFILE[$prov]}" 2>/dev/null || echo 1)"
    local now; now=$(date +%s); local ms=$(( (now - ${START[$prov]:-$now}) ))
    local status="returned"
    case "$rc" in
      0) status="returned";;
      124) status="timeout";;
      127) status="absent";;
      *) status="error";;
    esac
    [ -s "$out_dir/$prov.out" ] || { [ "$status" = "returned" ] && status="error"; }
    echo "$prov:$status sec=$ms"
    echo "$prov:$status:$ms" >> "$manifest"
  done
}

# Scoping huddle: the panel collectively advises on APPROACH before any mode is
# chosen. This is how "the models analyze the task together and determine the
# best way to move forward" — the conductor reads their framings, then decides.
cmd_huddle() {
  local task_file="${1:?usage: huddle <task_file> <out_dir> [csv]}"
  local out_dir="${2:?missing out_dir}"; local csv="${3:-}"
  mkdir -p "$out_dir"
  local mp="$out_dir/huddle-prompt.txt"
  { echo "We are a panel of AI models about to collaborate on the task below. Advise on APPROACH only — do NOT solve it yet."
    echo ""; echo "TASK:"; cat "$task_file"; echo ""
    echo "In under 120 words: (1) how would you frame or decompose this; (2) which collaboration style fits best — independent panel, structured debate, multi-round council, parallel division of labor (swarm), or whether a single model already suffices; (3) the biggest risk or blind spot to watch. Be concrete."
  } > "$mp"
  echo "[fusion] huddle: panel advising on approach (not solving yet) → $out_dir" >&2
  cmd_panel "$mp" "$out_dir" "$csv"
}

case "${1:-help}" in
  detect)    shift; bash "$DETECT" "$@";;
  route)     shift; bash "$ROUTE" "$@";;
  dispatch)  shift; cmd_dispatch "$@";;
  panel)     shift; cmd_panel "$@";;
  huddle)    shift; cmd_huddle "$@";;
  ledger)    shift; bash "$LEDGER" "$@";;
  providers)
    # Resolve from the SAME layer dispatch reads (config/defaults.env), so this
    # listing can never drift from what a panel would actually run. Hardcoding
    # the models here is how the old output ended up advertising glm-5.2 long
    # after the default had moved.
    . "$DIR/../config/defaults.env" 2>/dev/null || true
    echo "Fusion default panel (orchestrator = in-context host: \$FUSION_HOST=$FUSION_HOST):"
    printf '  %-11s %-32s %-16s %s\n' \
      "codex"    "${FUSION_CODEX_MODEL:-gpt-5.6-sol}"        "effort ${FUSION_CODEX_EFFORT:-xhigh}"        "(OpenAI — dispatchable unless FUSION_HOST=codex)" \
      "kimi"     "${FUSION_KIMI_MODEL:-azure/kimi-k3}"       ""                                            "(Moonshot)" \
      "opencode" "${FUSION_OPENCODE_MODEL:-}"                "variant ${FUSION_OPENCODE_VARIANT:-xhigh}"   "(OpenCode)" \
      "grok"     "${FUSION_GROK_MODEL:-grok-4.5}"            "web-search on"                               "(xAI)" \
      "copilot"  "${FUSION_COPILOT_MODEL:-}"                 ""                                            "(GitHub Copilot)" \
      "andrewcode" "${FUSION_ANDREWCODE_MODEL:-meta/muse-spark-1.3-contributor}" "effort ${FUSION_ANDREWCODE_EFFORT:-xhigh}" "(AndrewCode — nested hive workers)"
    echo ""
    echo "MetaLoop participants (fusion:metaloop):"
    printf '  %-9s %-32s %-16s %s\n' \
      "fable"    "${FUSION_FABLE_MODEL:-fable}"              "CEO / advisor"  "(Anthropic; frames every run first — never a worker/vote)" \
      "codex"    "${FUSION_CODEX_MODEL:-gpt-5.6-sol}"        "CHIEF OPERATOR" "(dispatched: plan, adjudicate, integration review)" \
      "agy x2"   "${FUSION_AGY_MODEL:-gemini-3.6-flash-high}" "fast tier"     "(Antigravity CLI; two sessions = one gemini family)"
    echo "  opencode/grok serve as MetaLoop EXPERT-tier workers. copilot is NOT a MetaLoop worker."
    echo "  Nested hive workers are always andrewcode processes (FUSION_ANDREWCODE_AUTO=1 → --auto -y)."
    ;;
  board)     shift; exec bash "$BOARD" "$@";;
  hive)      shift; exec bash "$HIVE" "$@";;
  version)   echo "fusion $FUSION_VERSION";;
  help|*)
    sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    ;;
esac
