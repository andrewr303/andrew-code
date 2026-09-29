#!/usr/bin/env bash
# fusion/scripts/ultraswarm.sh -- select OpenCode/Copilot models for Fusion UltraSwarm.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pybin() {
  for c in python3 python py; do
    command -v "$c" >/dev/null 2>&1 && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

PY="$(pybin)" || { echo "[fusion] Python 3 not found" >&2; exit 127; }
exec "$PY" "$ROOT/scripts/ultraswarm_selector.py" "$@"
