#!/usr/bin/env bash
# fusion/tests/smoke-providers.sh — LIVE smoke test of each panelist adapter.
#
# Sends a one-word prompt to every available panelist and checks for a usable
# reply. This makes real (small, paid) API calls — run when verifying setup, not
# in CI. ~1–3 minutes. Proves dispatch is real, not simulated.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROV="$ROOT/scripts/providers"

SM="$(mktemp -d "${TMPDIR:-/tmp}/fusion-smoke.XXXXXX")"
trap 'rm -rf "$SM" 2>/dev/null || true' EXIT
printf '%s\n' 'Reply with exactly the single word PONG and nothing else. Do not use any tools.' > "$SM/p.txt"

echo "✦ Fusion live smoke test (one-word prompt per panelist)"
echo ""

declare -A PID RC
run() { # run <name> <adapter> [args...]
  local name="$1"; shift
  local adapter="$1"; shift
  if [ ! -x "$adapter" ] && [ ! -f "$adapter" ]; then echo "$name: no adapter"; return; fi
  ( bash "$adapter" "$SM/p.txt" "$SM/$name.out" "$@" >/dev/null 2>"$SM/$name.log"; echo $? > "$SM/$name.rc" ) &
  PID[$name]=$!
}

# fast/cheap settings for smoke
run codex    "$PROV/codex.sh"    gpt-5.5            low     read-only
run copilot  "$PROV/copilot.sh"  gemini-3.5-flash
run opencode "$PROV/opencode.sh" opencode-go/glm-5.2 minimal
run grok     "$PROV/grok.sh"     "" ""
# MetaLoop-only participants (optional): Antigravity fast worker + Fable advisor.
run agy      "$PROV/agy.sh"      ""
run fable    "$PROV/fable.sh"    ""

for n in "${!PID[@]}"; do wait "${PID[$n]}" 2>/dev/null || true; done

fails=0
for n in codex copilot opencode grok agy fable; do
  rc=1; [ -f "$SM/$n.rc" ] && rc="$(cat "$SM/$n.rc")"
  out="$(head -c 80 "$SM/$n.out" 2>/dev/null | tr -d '\n')"
  if [ "$rc" = "0" ] && [ -s "$SM/$n.out" ]; then
    printf "  \033[32mLIVE\033[0m %-9s → %s\n" "$n" "${out:-<empty>}"
  elif [ "$rc" = "127" ]; then
    printf "  \033[33mMISS\033[0m %-9s → not installed\n" "$n"
  else
    printf "  \033[31mFAIL\033[0m %-9s → rc=%s  %s\n" "$n" "$rc" "$(tail -n1 "$SM/$n.log" 2>/dev/null)"
    fails=$((fails+1))
  fi
done

echo ""
if [ "$fails" -eq 0 ]; then
  echo "✦ smoke: every installed panelist dispatched and replied."
else
  echo "✦ smoke: $fails installed panelist(s) failed to reply (auth/runtime — see logs above)."
  exit 1
fi
