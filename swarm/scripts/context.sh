#!/usr/bin/env bash
# fusion/scripts/context.sh — Git-Bash wrapper for the agency-context CLI.
# Sets PYTHONPATH to ../python and runs fusion_swarm.comms context.
#   bash context.sh list
#   bash context.sh get <key>
#   bash context.sh set <key> <value>
#   bash context.sh clear
#   bash context.sh snapshot
# Extra flags (--dir, --cwd) may precede the action.
# Avoids `python -m fusion_swarm.comms` so the plugin-root shim
# swarm/fusion_swarm.py cannot shadow the package when cwd is swarm/.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYROOT="$DIR/../python"
PY="${FUSION_PYTHON:-}"
if [ -z "$PY" ]; then
  if command -v python >/dev/null 2>&1; then PY=python
  elif command -v py >/dev/null 2>&1; then PY=py
  elif command -v python3 >/dev/null 2>&1; then PY=python3
  else echo "[fusion] no python found (set FUSION_PYTHON)" >&2; exit 127; fi
fi
export PYTHONPATH="$PYROOT${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1
exec "$PY" -c '
import os, sys
sys.path.insert(0, os.environ["PYTHONPATH"].split(os.pathsep)[0])
from fusion_swarm.comms import main
raise SystemExit(main(["context", *sys.argv[1:]]))
' "$@"
