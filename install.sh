#!/usr/bin/env bash
# Build and install AndrewCode (shims + PATH hint).
#
# Thin wrapper around scripts/install-andrewcode.mjs (which delegates to
# apps/kimi-code/scripts/install-path.mjs). Builds all packages + the CLI
# bundle, writes `andrewcode`/`kimi` shims to ~/.andrewcode/bin, and runs
# smoke checks. Safe to re-run over an existing install.
#
# Usage:
#   ./install.sh              full pnpm install + build + shim install
#   ./install.sh --skip-build rewrite shims only (dist/ already fresh)
#   ./install.sh --write-rc   also append PATH export to your shell rc
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v node >/dev/null 2>&1 || { echo 'node is not on PATH. Install Node >= 24.15.0 first (see .nvmrc).' >&2; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo 'pnpm is not on PATH. Install pnpm 10.33.0: https://pnpm.io/installation' >&2; exit 1; }

node "$REPO_ROOT/scripts/install-andrewcode.mjs" "$@"

echo ''
echo 'AndrewCode installed. Ensure ~/.andrewcode/bin is on PATH, then verify:'
echo '  andrewcode --version && andrewcode login --status'
