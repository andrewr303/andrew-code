#!/usr/bin/env node
/**
 * Cross-platform local PATH install for AndrewCode.
 *
 * Builds (unless --skip-build) and installs shims into:
 *   Windows: %USERPROFILE%\.andrewcode\bin
 *   POSIX:   ~/.andrewcode/bin
 *
 * On Windows, permanently prepends that dir to the User PATH.
 * On POSIX, prints the export line to add (does not edit shell rc by default;
 * pass --write-rc to append to ~/.bashrc / ~/.zshrc if present).
 *
 * Usage:
 *   node apps/kimi-code/scripts/install-path.mjs
 *   node apps/kimi-code/scripts/install-path.mjs --skip-build
 *   node apps/kimi-code/scripts/install-path.mjs --skip-install
 *   node apps/kimi-code/scripts/install-path.mjs --bin-dir D:\tools\andrewcode\bin
 *   pnpm -C apps/kimi-code run install:path
 *
 * Re-running updates an existing install: pnpm install, rebuild, overwrite
 * shims (retargeting them to this checkout), and move the bin dir to the
 * front of the Windows User PATH.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(APP_ROOT, '../..');
const MAIN_MJS = join(APP_ROOT, 'dist', 'main.mjs');
const WINDOWS_PATH_HELPER = join(SCRIPT_DIR, 'windows-user-path.ps1');
const isWin = process.platform === 'win32';

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const skipBuild = args.has('--skip-build');
const skipInstall = args.has('--skip-install');
const writeRc = args.has('--write-rc');

function readFlagValue(flag) {
  const index = rawArgs.indexOf(flag);
  if (index === -1) return undefined;
  const value = rawArgs[index + 1];
  if (value === undefined || value.startsWith('--')) return undefined;
  return value;
}

function resolveDataDir() {
  const andrew = process.env['ANDREWCODE_HOME']?.trim();
  if (andrew) return andrew;
  const legacy = process.env['KIMI_CODE_HOME']?.trim();
  if (legacy) return legacy;
  return join(homedir(), '.andrewcode');
}

function resolveBinDir() {
  const fromFlag = readFlagValue('--bin-dir');
  if (fromFlag !== undefined && fromFlag.length > 0) return resolve(fromFlag);
  return join(resolveDataDir(), 'bin');
}

const BIN_DIR = resolveBinDir();
const INSTALL_ORIGIN = join(BIN_DIR, 'install-origin.json');

function log(msg) {
  process.stderr.write(`[andrewcode] ${msg}\n`);
}

function run(cmd, cmdArgs, cwd, options = {}) {
  // Never shell-wrap absolute Node paths: `C:\Program Files\...` breaks under cmd.
  const useShell = options.shell ?? (isWin && !/[\\/]/.test(cmd) && !cmd.endsWith('.exe'));
  const r = spawnSync(cmd, cmdArgs, {
    cwd,
    stdio: 'inherit',
    shell: useShell,
    env: process.env,
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(' ')} failed (exit ${r.status ?? 1})`);
  }
}

function checkPrerequisites() {
  const nodeMajor = parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (nodeMajor < 24) {
    throw new Error(`Node ${process.versions.node} is too old — AndrewCode requires Node >=24.15.0. See .nvmrc.`);
  }
  const pnpmCheck = spawnSync('pnpm', ['--version'], { encoding: 'utf8', windowsHide: true, shell: true });
  if (pnpmCheck.status !== 0) {
    throw new Error('pnpm not found on PATH — install pnpm 10.33.0: https://pnpm.io/installation');
  }
  const pnpmVer = (pnpmCheck.stdout ?? '').trim();
  log(`Prerequisites: node ${process.versions.node}, pnpm ${pnpmVer}`);
}

function ensureInstalled() {
  if (skipInstall) {
    log('Skip pnpm install');
    return;
  }
  const hadModules = existsSync(join(REPO_ROOT, 'node_modules'));
  log(
    hadModules
      ? 'Refreshing dependencies (pnpm install) so an existing checkout picks up lockfile changes…'
      : 'Installing dependencies (pnpm install)…',
  );
  run('pnpm', ['install', '--frozen-lockfile=false'], REPO_ROOT, { shell: true });
}

function ensureBuilt() {
  if (skipBuild) {
    if (!existsSync(MAIN_MJS)) {
      throw new Error(`Missing ${MAIN_MJS}; build first or drop --skip-build`);
    }
    log('Skip build');
    return;
  }
  checkPrerequisites();
  ensureInstalled();
  log('Building packages (agent-core, agent-core-v2, oauth, sdk, …)…');
  // Use double-quoted filter so Windows PowerShell/cmd don't strip the pattern.
  run('pnpm', ['-r', '--filter', './packages/*', 'run', 'build'], REPO_ROOT, {
    shell: true,
  });
  log('Building CLI (apps/kimi-code → dist/main.mjs, includes Fusion + swarm + evaluator)…');
  run('pnpm', ['-C', 'apps/kimi-code', 'run', 'build'], REPO_ROOT, { shell: true });
  if (!existsSync(MAIN_MJS)) {
    throw new Error(`Build finished but ${MAIN_MJS} is missing`);
  }
  // Verify the revamped agent made it into the bundle
  try {
    const bundle = readFileSync(MAIN_MJS, 'utf8');
    const checks = [
      ['Fusion', 'Fusion tool'],
      ['AgentSwarm', 'AgentSwarm tool'],
      ['evaluator', 'evaluator subagent'],
      ['andrewcode', 'AndrewCode branding'],
    ];
    for (const [needle, label] of checks) {
      if (!bundle.includes(needle)) log(`warning: bundle missing ${label} marker "${needle}"`);
    }
  } catch {
    // non-fatal
  }
}

function readExistingShimTarget() {
  const cmd = join(BIN_DIR, isWin ? 'andrewcode.cmd' : 'andrewcode');
  if (!existsSync(cmd)) return undefined;
  try {
    const text = readFileSync(cmd, 'utf8');
    const match = /node\s+"([^"]+)"/.exec(text) ?? /exec node "([^"]+)"/.exec(text);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function writeFileReplace(path, content, encoding) {
  try {
    if (existsSync(path)) chmodSync(path, 0o666);
  } catch {
    // continue and let writeFileSync throw if the file is truly locked
  }
  const tmp = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(tmp, content, encoding);
  try {
    try {
      unlinkSync(path);
    } catch {
      // dest may not exist
    }
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, content, encoding);
    try {
      unlinkSync(tmp);
    } catch {
      // ignore leftover temp
    }
  }
}

function writeInstallOrigin(mainAbs) {
  const payload = {
    product: 'andrewcode',
    binDir: BIN_DIR,
    main: mainAbs,
    repo: REPO_ROOT,
    updatedAt: new Date().toISOString(),
  };
  writeFileReplace(INSTALL_ORIGIN, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeShims() {
  mkdirSync(BIN_DIR, { recursive: true });
  const mainAbs = resolve(MAIN_MJS);
  const previous = readExistingShimTarget();
  if (previous !== undefined && previous !== mainAbs) {
    log(`Retargeting existing shim:\n  was ${previous}\n  now ${mainAbs}`);
  } else if (previous === mainAbs) {
    log('Existing shim already points at this checkout — rewriting in place');
  } else {
    log('Writing new shims');
  }

  if (isWin) {
    const cmdBody = `@echo off\r\nsetlocal\r\nnode "${mainAbs}" %*\r\n`;
    writeFileReplace(join(BIN_DIR, 'andrewcode.cmd'), cmdBody, 'utf8');
    writeFileReplace(join(BIN_DIR, 'kimi.cmd'), cmdBody, 'utf8');
    const ps1 = `#!/usr/bin/env pwsh\n& node '${mainAbs.replace(/'/g, "''")}' @args\nexit $LASTEXITCODE\n`;
    writeFileReplace(join(BIN_DIR, 'andrewcode.ps1'), ps1, 'utf8');
    writeFileReplace(join(BIN_DIR, 'kimi.ps1'), ps1, 'utf8');
  } else {
    const sh = `#!/usr/bin/env bash\nexec node "${mainAbs}" "$@"\n`;
    const andrew = join(BIN_DIR, 'andrewcode');
    const kimi = join(BIN_DIR, 'kimi');
    writeFileReplace(andrew, sh, 'utf8');
    writeFileReplace(kimi, sh, 'utf8');
    chmodSync(andrew, 0o755);
    chmodSync(kimi, 0o755);
  }
  writeInstallOrigin(mainAbs);
  log(`Shims → ${BIN_DIR}`);
}

function addWindowsUserPath() {
  if (!existsSync(WINDOWS_PATH_HELPER)) {
    throw new Error(`Missing PATH helper: ${WINDOWS_PATH_HELPER}`);
  }
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      WINDOWS_PATH_HELPER,
      '-BinDir',
      BIN_DIR,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.status !== 0) {
    throw new Error(`Failed to update User PATH: ${r.stderr || r.stdout}`);
  }
  const out = (r.stdout || '').trim().split(/\r?\n/).pop() ?? '';
  if (out === 'added') {
    log(`Added to User PATH (front): ${BIN_DIR}`);
  } else if (out === 'moved') {
    log(`Moved existing User PATH entry to the front: ${BIN_DIR}`);
  } else {
    log(`User PATH already starts with ${BIN_DIR}`);
  }
}

function ensureSessionPath() {
  const parts = (process.env.PATH || process.env.Path || '').split(isWin ? ';' : ':');
  if (!parts.some((p) => p.replace(/[\\/]+$/, '') === BIN_DIR.replace(/[\\/]+$/, ''))) {
    process.env.PATH = isWin ? `${BIN_DIR};${process.env.PATH || ''}` : `${BIN_DIR}:${process.env.PATH || ''}`;
    log('Prepended to this process PATH (child smoke tests only)');
  }
}

function maybeWritePosixRc() {
  if (isWin || !writeRc) {
    if (!isWin) {
      log(`Add to your shell profile: export PATH="${BIN_DIR}:$PATH"`);
    }
    return;
  }
  const line = `export PATH="${BIN_DIR}:$PATH"  # andrewcode`;
  const shell = process.env.SHELL || '';
  const candidates = [];
  if (shell.includes('zsh')) candidates.push(join(homedir(), '.zshrc'));
  if (shell.includes('bash')) candidates.push(join(homedir(), '.bashrc'));
  candidates.push(join(homedir(), '.profile'));
  for (const rc of candidates) {
    if (!existsSync(rc)) continue;
    const text = readFileSync(rc, 'utf8');
    if (text.includes('.andrewcode/bin')) {
      log(`Already referenced in ${rc}`);
      return;
    }
    writeFileSync(rc, `${text.trimEnd()}\n\n${line}\n`, 'utf8');
    log(`Appended PATH export to ${rc}`);
    return;
  }
  log('No shell rc found to edit; add PATH manually');
}

function smoke() {
  log('Smoke: --version');
  run(process.execPath, [MAIN_MJS, '--version'], REPO_ROOT);
  log('Smoke: login --status');
  run(process.execPath, [MAIN_MJS, 'login', '--status'], REPO_ROOT);
  if (isWin) {
    const shim = join(BIN_DIR, 'andrewcode.cmd');
    if (existsSync(shim)) {
      log('Smoke: installed shim --version');
      run('cmd.exe', ['/d', '/s', '/c', shim, '--version'], REPO_ROOT);
    }
  }
}

function main() {
  ensureBuilt();
  writeShims();
  if (isWin) addWindowsUserPath();
  else maybeWritePosixRc();
  ensureSessionPath();
  smoke();
  log('Install complete. Re-run this installer to update an existing install.');
  process.stdout.write(
    [
      '',
      '  Commands:',
      '    andrewcode --version',
      '    andrewcode login --status',
      '    andrewcode login --codex',
      '    andrewcode login xai',
      '    andrewcode login',
      '',
      '  Skills/plugins default to ~/.claude/skills, ~/.claude/plugins,',
      '  plus project .claude/skills and .claude/plugins (then .andrewcode / .agents).',
      '',
      isWin
        ? '  User PATH was rewritten so this bin dir is first. If this shell still resolves an old andrewcode, run .\\install.ps1 (it refreshes the session) or open a new terminal.'
        : `  Ensure PATH includes: ${BIN_DIR}`,
      '',
    ].join('\n'),
  );
}

try {
  main();
} catch (err) {
  process.stderr.write(`[andrewcode] ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
