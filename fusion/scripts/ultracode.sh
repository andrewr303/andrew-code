#!/usr/bin/env bash
# fusion/scripts/ultracode.sh -- local bridge to the bundled UltraCode-Shim.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UC="$ROOT/ultracode"

usage() {
  cat <<'EOF'
usage: scripts/ultracode.sh <doctor|test|launch|status|install> [args...]

doctor   Run UltraCode config/CLI doctor from the bundled checkout.
test     Run the offline proxy self-test; no network or keys.
launch   Launch the bundled UltraCode launcher.
status   Show running proxy status if one is active.
install  Run UltraCode's own installer from this checkout.
EOF
}

pybin() {
  for c in python3 python py; do
    command -v "$c" >/dev/null 2>&1 && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

[ -d "$UC" ] || { echo "[fusion] bundled ultracode folder not found: $UC" >&2; exit 2; }

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  doctor)
    PY="$(pybin)" || { echo "[fusion] Python 3 not found" >&2; exit 127; }
    "$PY" "$UC/scripts/doctor.py" "$@"
    ;;
  test)
    PY="$(pybin)" || { echo "[fusion] Python 3 not found" >&2; exit 127; }
    "$PY" "$UC/test_proxy.py" "$@"
    ;;
  launch)
    # When invoked from the fusion skill/agent terminal (non-interactive or FUSION_ULTRACODE set),
    # start the proxy only (do not exec claude, which would block the tool and is meant for
    # the *user's* interactive Claude Code). The user then runs the real `ultracode` command
    # or Windows launcher from their shell/desktop for a full session.
    if [[ -n "${FUSION_ULTRACODE:-}" || ! -t 1 || "${1:-}" == "--proxy-only" ]]; then
      echo "[fusion] launch (proxy-only): ensuring UltraCode proxy is up..."
      bash "$UC/bin/ultracode" --internal-proxy-only "$@"
      exit $?
    fi
    bash "$UC/bin/ultracode" "$@"
    ;;
  status)
    bash "$UC/bin/ultracode" status "$@"
    ;;
  install)
    bash "$UC/install.sh" "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "[fusion] unknown ultracode command: $cmd" >&2
    usage >&2
    exit 2
    ;;
esac
