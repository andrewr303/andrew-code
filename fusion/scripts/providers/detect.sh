#!/usr/bin/env bash
# fusion/scripts/providers/detect.sh — tri-state panelist availability probe.
#
# Emits one line per provider between markers:
#     PROVIDER_CHECK_START
#     <name>:available|missing|degraded
#     PROVIDER_CHECK_END
# `--json` prints a machine-readable object instead.
#
# Philosophy (from fusion-main + octopus): detection is a fast install-time
# presence/capability check. Real auth failures are caught at dispatch and
# trigger the runtime fallback — we do NOT block a panelist here on a slow
# auth round-trip. "degraded" = present but known quota/auth-dead this session
# (recorded by the ledger), surfaced so the roster builder can skip it.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

FUSION_STATE_DIR="${FUSION_STATE_DIR:-$HOME/.fusion}"
DEGRADED_FILE="$FUSION_STATE_DIR/degraded-providers"
ALLOWLIST_FILE="${FUSION_ALLOWLIST:-$FUSION_STATE_DIR/panel-allowlist}"

is_degraded() {
  [ -f "$DEGRADED_FILE" ] && grep -qxF "$1" "$DEGRADED_FILE" 2>/dev/null
}
is_allowed() {
  # If an allowlist exists, only listed providers may be used.
  [ -f "$ALLOWLIST_FILE" ] || return 0
  grep -qxF "$1" "$ALLOWLIST_FILE" 2>/dev/null
}

probe() {
  local name="$1" bin="$2"
  if ! is_allowed "$name"; then echo "missing"; return; fi
  if ! command -v "$bin" >/dev/null 2>&1; then echo "missing"; return; fi
  if is_degraded "$name"; then echo "degraded"; return; fi
  echo "available"
}

# Codex is the default host orchestrator in this plugin. The host is marked as
# host-native so it is never counted as an external subprocess panelist.
# This install lives under ~/.claude — Claude Code is the host, so codex is an
# external, dispatchable panelist (the MetaLoop Chief Operator). Set
# FUSION_HOST=codex when running under the Codex CLI.
FUSION_HOST="${FUSION_HOST:-claude}"
host_or_probe() {
  local name="$1" bin="$2"
  if [ "$name" = "$FUSION_HOST" ]; then echo "host-native"; return; fi
  probe "$name" "$bin"
}

S_CLAUDE="missing"
[ "$FUSION_HOST" = "claude" ] && S_CLAUDE="host-native"
S_CODEX="$(host_or_probe codex codex)"
S_COPILOT="$(host_or_probe copilot copilot)"
S_OPENCODE="$(host_or_probe opencode opencode)"
S_GROK="$(host_or_probe grok grok)"
# MetaLoop-only participants (kept OUT of the base .providers panel so existing
# fusion modes are unchanged): the Antigravity fast worker and the Fable advisor.
# The Fable advisor rides the `claude` CLI in print mode even when Codex is host.
S_AGY="$(probe agy agy)"
# Co-leader seat (Kimi Code CLI). Registered as a first-class panelist so the
# /fusion:graph default roster (claude leader / kimi co-leader / agy workers)
# is discoverable rather than implicit.
S_KIMI="$(host_or_probe kimi kimi)"
S_FABLE="$(probe fable claude)"

if [ "${1:-}" = "--json" ]; then
  avail=0
  for s in "$S_CODEX" "$S_COPILOT" "$S_OPENCODE" "$S_GROK"; do
    [ "$s" = "available" ] && avail=$((avail+1))
  done
  multi="false"; [ "$avail" -ge 1 ] && multi="true"
  printf '{"providers":{"claude":"%s","codex":"%s","copilot":"%s","opencode":"%s","grok":"%s","kimi":"%s"},"metaloop":{"agy":"%s","fable":"%s"},"live_panelists":%d,"multi_model":%s}\n' \
    "$S_CLAUDE" "$S_CODEX" "$S_COPILOT" "$S_OPENCODE" "$S_GROK" "$S_KIMI" "$S_AGY" "$S_FABLE" "$avail" "$multi"
  exit 0
fi

echo "PROVIDER_CHECK_START"
echo "claude:$S_CLAUDE"
echo "codex:$S_CODEX"
echo "copilot:$S_COPILOT"
echo "opencode:$S_OPENCODE"
echo "grok:$S_GROK"
echo "kimi:$S_KIMI"
echo "agy:$S_AGY"
echo "fable:$S_FABLE"
echo "PROVIDER_CHECK_END"
