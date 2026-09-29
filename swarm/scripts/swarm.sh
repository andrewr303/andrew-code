#!/usr/bin/env bash
# fusion/scripts/swarm.sh — bridge from bash/skills to the Python swarm patterns.
# Sets PYTHONPATH and runs `python -m fusion_swarm <args>`.
#   bash swarm.sh moa "task..." --layers 2
#   bash swarm.sh heavy "task..." --json
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
PYTHONPATH="$PYROOT${PYTHONPATH:+:$PYTHONPATH}" PYTHONIOENCODING=utf-8 PYTHONUTF8=1 \
  "$PY" -m fusion_swarm "$@"
