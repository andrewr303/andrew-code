#!/usr/bin/env bash
# fusion/scripts/dashboard.sh -- launch the Fusion localhost config dashboard.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

pybin() {
  for c in python3 python py; do
    command -v "$c" >/dev/null 2>&1 && { printf '%s\n' "$c"; return 0; }
  done
  return 1
}

PY="$(pybin)" || { echo "[fusion] Python 3 not found (tried python3, python, py)" >&2; exit 127; }
exec "$PY" "$ROOT/scripts/dashboard_server.py" "$@"
