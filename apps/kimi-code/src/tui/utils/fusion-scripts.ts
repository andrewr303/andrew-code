/**
 * Fusion plugin script bridge.
 *
 * Locates the Fusion plugin's shell scripts (fusion.sh, dashboard.sh,
 * ultracode.sh, ...) and runs them through a resolved bash. Scripts are never
 * spawned by bare command name: bash is resolved via resolveCommandPath (which
 * refuses hits inside the cwd), with the Git-for-Windows path as an explicit
 * win32 fallback. Kept UI-independent so it can be tested in isolation.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { getHostPackageRoot } from '#/cli/version';
import { openUrl } from '#/utils/open-url';
import { resolveCommandPath } from '#/utils/process/resolve-command';

const GIT_BASH_WIN32 = 'C:/Program Files/Git/bin/bash.exe';
const DASHBOARD_URL_PATTERN = /https?:\/\/127\.0\.0\.1:\d+\//;
const DASHBOARD_STARTUP_BUDGET_MS = 15000;

export interface FusionScriptResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface FusionScriptRunOptions {
  cwd?: string;
  timeoutMs?: number;
}

/** Script-backed Fusion form ids that map 1:1 onto a plugin shell script. */
export type FusionScriptForm =
  | 'graph'
  | 'hive'
  | 'designer'
  | 'metaloop'
  | 'ultracode'
  | 'ultraswarm'
  | 'board'
  | 'context'
  | 'detect';

const SCRIPT_FORM_FILES: Readonly<Record<FusionScriptForm, string>> = {
  graph: 'swarm.sh',
  hive: 'swarm.sh',
  designer: 'swarm.sh',
  metaloop: 'swarm.sh',
  ultracode: 'ultracode.sh',
  ultraswarm: 'ultraswarm.sh',
  board: 'board.sh',
  context: 'context.sh',
  detect: 'fusion.sh',
};

/** File name of the plugin script that implements a script-backed Fusion form. */
export function fusionScriptFileName(form: FusionScriptForm): string {
  return SCRIPT_FORM_FILES[form];
}

export interface FusionScriptFormInput {
  readonly prompt?: string;
  readonly boardVerb?: string;
  readonly boardDb?: string;
  readonly contextAction?: string;
  readonly contextKey?: string;
  readonly contextValue?: string;
}

/**
 * Map a script form onto `{ script, args }` for `runFusionScript`.
 * ultraswarm: prompt, or `--discover` when the prompt is empty.
 * board: verb (default `agents`) plus optional `--db`.
 * context: action (default `list`) plus key/value when set.
 */
export function fusionScriptCommand(
  form: FusionScriptForm,
  input: FusionScriptFormInput = {},
): { script: string; args: string[] } {
  const script = fusionScriptFileName(form);
  if (form === 'ultraswarm') {
    const prompt = input.prompt?.trim() ?? '';
    return {
      script,
      args: prompt.length > 0 ? ['--non-interactive', '--task', prompt] : ['--discover'],
    };
  }
  if (form === 'board') {
    const explicit = input.boardDb?.trim();
    const env = process.env['FUSION_BOARD']?.trim();
    const state = process.env['FUSION_STATE_DIR']?.trim();
    const db =
      (explicit !== undefined && explicit.length > 0 ? explicit : undefined) ??
      (env !== undefined && env.length > 0 ? env : undefined) ??
      join(state !== undefined && state.length > 0 ? state : join(homedir(), '.fusion'), 'hive', 'board.sqlite');
    return { script, args: ['--db', db, input.boardVerb?.trim() || 'agents'] };
  }
  if (form === 'context') {
    const action = input.contextAction?.trim() || 'list';
    const args = [action];
    const key = input.contextKey?.trim();
    if (key !== undefined && key.length > 0) args.push(key);
    if (input.contextValue !== undefined && (action === 'set' || input.contextValue.length > 0)) {
      args.push(input.contextValue);
    }
    return { script, args };
  }
  return { script, args: [] };
}

/**
 * Resolve the Fusion plugin's scripts directory. Candidate order:
 * FUSION_PLUGIN_ROOT (used as-is when it already names a `scripts` dir),
 * ~/.andrewcode/plugins/managed/fusion/scripts, ~/.claude/plugins/fusion/scripts,
 * and the packaged `<appRoot>/fusion-plugin/scripts`. The directory must
 * contain fusion.sh; otherwise the next candidate is tried.
 */
export function resolveFusionScriptsRoot(): string | undefined {
  const candidates: string[] = [];
  const envRoot = process.env['FUSION_PLUGIN_ROOT'];
  if (envRoot !== undefined && envRoot.trim().length > 0) {
    const root = envRoot.trim();
    candidates.push(basename(root) === 'scripts' ? root : join(root, 'scripts'));
  }
  candidates.push(
    join(homedir(), '.andrewcode', 'plugins', 'managed', 'fusion', 'scripts'),
    join(homedir(), '.claude', 'plugins', 'fusion', 'scripts'),
  );
  try {
    candidates.push(join(getHostPackageRoot(), 'fusion-plugin', 'scripts'));
  } catch {
    // No package.json ancestry — the packaged dir is unknowable; skip it.
  }
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'fusion.sh'))) return candidate;
  }
  return undefined;
}

function resolveBash(): string {
  const resolved = resolveCommandPath('bash');
  if (resolved !== undefined) return resolved;
  if (process.platform === 'win32' && existsSync(GIT_BASH_WIN32)) return GIT_BASH_WIN32;
  throw new Error('bash not found on PATH. Install Git for Windows or add bash to PATH.');
}

/** Run a Fusion plugin shell script through bash, capturing its output.
 * Rejects on spawn errors; on timeout the child is killed and the result
 * carries `exitCode: null` with a note appended to stderr. */
export function runFusionScript(
  script: string,
  args: string[],
  opts: FusionScriptRunOptions = {},
): Promise<FusionScriptResult> {
  return new Promise((resolve, reject) => {
    let bash: string;
    try {
      bash = resolveBash();
    } catch (error) {
      reject(error);
      return;
    }
    const scriptPath = script.replaceAll('\\', '/');
    const child = spawn(bash, [scriptPath, ...args], {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    if (opts.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, opts.timeoutMs);
    }
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (timedOut) {
        stderr += `\n[fusion] ${basename(script)} timed out after ${opts.timeoutMs}ms.`;
      }
      resolve({ stdout, stderr, exitCode: code });
    });
  });
}

/**
 * Start the Fusion dashboard server detached (it keeps running after the TUI
 * exits) and open its URL. Reads the child's first stdout line for the
 * `http://127.0.0.1:<port>/` URL within a bounded startup budget. Resolves to
 * the URL when found, or undefined when startup could not be confirmed (the
 * caller shows a manual-open fallback; the server itself is left running).
 */
export function openFusionDashboard(port: number): Promise<string | undefined> {
  const scriptsRoot = resolveFusionScriptsRoot();
  if (scriptsRoot === undefined) return Promise.resolve(undefined);
  let bash: string;
  try {
    bash = resolveBash();
  } catch {
    return Promise.resolve(undefined);
  }
  const scriptPath = join(scriptsRoot, 'dashboard.sh').replaceAll('\\', '/');
  const child = spawn(bash, [scriptPath], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: {
      ...process.env,
      FUSION_DASHBOARD_PORT: String(port),
      FUSION_DASHBOARD_NO_OPEN: '1',
    },
  });
  child.unref();
  child.stderr?.setEncoding('utf8');
  // Keep draining stderr so a chatty dashboard never blocks on a full pipe.
  child.stderr?.resume();

  const urlPromise = new Promise<string | undefined>((resolve) => {
    let stdoutBuf = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuf += chunk;
      const match = stdoutBuf.match(DASHBOARD_URL_PATTERN);
      if (match === null) return;
      const url = match[0];
      openUrl(url);
      child.stdout?.removeAllListeners('data');
      child.stdout?.resume();
      resolve(url);
    });
  });
  const errorPromise = new Promise<string | undefined>((resolve) => {
    child.on('error', () => resolve(undefined));
  });
  const timeoutPromise = new Promise<string | undefined>((resolve) => {
    const timer = setTimeout(() => resolve(undefined), DASHBOARD_STARTUP_BUDGET_MS);
    timer.unref();
  });

  return Promise.race([urlPromise, errorPromise, timeoutPromise]).finally(() => {
    // Startup budget over — stop watching output; the server keeps running.
    child.stdout?.removeAllListeners('data');
    child.stdout?.resume();
    child.removeAllListeners('error');
  });
}