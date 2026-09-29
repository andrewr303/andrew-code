#!/usr/bin/env node
/**
 * AndrewCode — top-level install entrypoint.
 *
 * Compiles the revamped agent (all packages + CLI with Fusion, AgentSwarm,
 * evaluator, long-running harness) and installs `andrewcode` (and `kimi`
 * alias) shims to `~/.andrewcode/bin`, updating PATH.
 *
 * This is the single command users run from the checkout:
 *   pnpm run install:andrewcode
 *   node scripts/install-andrewcode.mjs
 *   node scripts/install-andrewcode.mjs --skip-build
 *
 * Re-running updates an existing install. On Windows prefer .\\install.ps1
 * so the current session PATH is refreshed after shims are rewritten.
 *
 * It delegates to `apps/kimi-code/scripts/install-path.mjs` which owns the
 * actual build + shim logic, so there is one implementation.
 */

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');
const INSTALL_PATH = join(REPO_ROOT, 'apps', 'kimi-code', 'scripts', 'install-path.mjs');

const args = process.argv.slice(2);

const r = spawnSync(process.execPath, [INSTALL_PATH, ...args], {
  cwd: REPO_ROOT,
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
});

process.exit(r.status ?? 1);
