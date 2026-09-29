/**
 * `tools` domain — script-bridge plumbing for the `Fusion` tool.
 *
 * Owns the deterministic half of the script-backed Fusion forms: resolving
 * the bundled Fusion plugin scripts root (`fusion.sh` et al., via
 * `FUSION_PLUGIN_ROOT` or the standard plugin install locations), executing
 * scripts through `bash` (Git Bash on Windows), and mapping each script form
 * (graph / hive / designer / metaloop / ultracode / ultraswarm / board /
 * context / detect) to a concrete script invocation. Pure helpers exported
 * for tests; no scoped service.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

export type ScriptForm =
  | 'graph'
  | 'hive'
  | 'designer'
  | 'metaloop'
  | 'ultracode'
  | 'ultraswarm'
  | 'board'
  | 'context'
  | 'detect';

export interface ScriptFormCommand {
  readonly script: string;
  readonly args: readonly string[];
}

export type BoardVerb = 'init' | 'agents' | 'poll' | 'channels' | 'tree' | 'mentions';
export type ContextAction = 'list' | 'get' | 'set' | 'clear' | 'snapshot';

export interface ScriptFormInput {
  readonly prompt: string;
  readonly captains?: readonly string[];
  readonly childrenPerCaptain?: number;
  readonly dryRun?: boolean;
  readonly planFile?: string;
  readonly spec?: string;
  readonly verb?: string;
  readonly thinkingEffort?: string;
  readonly boardVerb?: BoardVerb;
  readonly boardDb?: string;
  readonly contextAction?: ContextAction;
  readonly contextKey?: string;
  readonly contextValue?: string;
}

export interface FusionScriptResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly error?: string;
}

const WINDOWS_GIT_BASH = 'C:/Program Files/Git/bin/bash.exe';

function whichBinary(binary: string): string | undefined {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(cmd, [binary], { encoding: 'utf8', windowsHide: true, timeout: 5_000 });
  if (r.status !== 0) return undefined;
  return (r.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
}

export function resolveBash(): string | undefined {
  const found = whichBinary('bash');
  if (found !== undefined) return found;
  if (process.platform === 'win32' && existsSync(WINDOWS_GIT_BASH)) return WINDOWS_GIT_BASH;
  return undefined;
}

function resolveCandidateScripts(candidate: string): string | undefined {
  const dir = basename(candidate) === 'scripts' ? candidate : join(candidate, 'scripts');
  return existsSync(join(dir, 'fusion.sh')) ? dir : undefined;
}

export function resolveFusionScriptsRoot(configured?: string): string | undefined {
  const envRoot = process.env['FUSION_PLUGIN_ROOT']?.trim();
  if (envRoot !== undefined && envRoot.length > 0) {
    const resolved = resolveCandidateScripts(envRoot);
    if (resolved !== undefined) return resolved;
  }
  const configuredRoot = configured?.trim();
  if (configuredRoot !== undefined && configuredRoot.length > 0) {
    const resolved = resolveCandidateScripts(configuredRoot);
    if (resolved !== undefined) return resolved;
  }
  const home = homedir();
  for (const candidate of [
    join(home, '.andrewcode', 'plugins', 'managed', 'fusion', 'scripts'),
    join(home, '.claude', 'plugins', 'fusion', 'scripts'),
  ]) {
    if (existsSync(join(candidate, 'fusion.sh'))) return candidate;
  }
  return undefined;
}

export function runFusionScript(options: {
  readonly script: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
  readonly env?: Record<string, string>;
}): Promise<FusionScriptResult> {
  const bash = resolveBash();
  if (bash === undefined) {
    return Promise.resolve({
      stdout: '',
      stderr: 'bash executable not found (install Git Bash or add it to PATH)',
      exitCode: 127,
      timedOut: false,
      error: 'bash executable not found on PATH',
    });
  }
  const script = options.script.replace(/\\/g, '/');
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const child = spawn(bash, [script, ...options.args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      windowsHide: true,
      shell: false,
      stdio: options.stdin !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (c: string) => {
      stdout += c;
    });
    child.stderr?.on('data', (c: string) => {
      stderr += c;
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref?.();
    }, options.timeoutMs);
    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.stdin !== undefined && child.stdin) {
      child.stdin.write(options.stdin);
      child.stdin.end();
    }
    const finish = (result: FusionScriptResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };
    child.on('error', (err) => {
      finish({ stdout, stderr, exitCode: 127, timedOut: false, error: err.message });
    });
    child.on('close', (code) => {
      finish({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });
  });
}

function resolveBoardDb(explicit?: string): string {
  const trimmed = explicit?.trim();
  if (trimmed !== undefined && trimmed.length > 0) return trimmed;
  const env = process.env['FUSION_BOARD']?.trim();
  if (env !== undefined && env.length > 0) return env;
  const state = process.env['FUSION_STATE_DIR']?.trim();
  const root = state !== undefined && state.length > 0 ? state : join(homedir(), '.fusion');
  return join(root, 'hive', 'board.sqlite');
}

export function scriptFormCommand(form: ScriptForm, input: ScriptFormInput): ScriptFormCommand {
  switch (form) {
    case 'hive': {
      const args: string[] = ['hive', input.prompt];
      const captains = (input.captains ?? []).filter((c) => c.trim().length > 0);
      if (captains.length > 0) args.push('--captains', captains.join(','));
      args.push('--children', String(input.childrenPerCaptain ?? 4));
      if (input.dryRun === true) args.push('--dry-run');
      return { script: 'swarm.sh', args };
    }
    case 'graph': {
      const args: string[] = ['graph', input.prompt];
      const spec = input.spec?.trim();
      if (spec !== undefined && spec.length > 0) args.push('--spec', spec);
      args.push(input.dryRun === true ? '--plan' : '--json');
      return { script: 'swarm.sh', args };
    }
    case 'designer':
      return { script: 'swarm.sh', args: ['designer', input.prompt] };
    case 'metaloop': {
      const args: string[] = ['metaloop', input.prompt];
      const planFile = input.planFile?.trim();
      if (planFile !== undefined && planFile.length > 0) args.push('--plan-file', planFile);
      return { script: 'swarm.sh', args };
    }
    case 'ultracode':
      return { script: 'ultracode.sh', args: [input.verb ?? 'doctor'] };
    case 'ultraswarm': {
      const prompt = input.prompt.trim();
      return {
        script: 'ultraswarm.sh',
        args: prompt.length > 0 ? ['--non-interactive', '--task', prompt] : ['--discover'],
      };
    }
    case 'board': {
      const args: string[] = ['--db', resolveBoardDb(input.boardDb), input.boardVerb ?? 'agents'];
      const extra = input.prompt.trim();
      if (extra.length > 0) args.push(...extra.split(/\s+/).filter((t) => t.length > 0));
      return { script: 'board.sh', args };
    }
    case 'context': {
      const action = input.contextAction ?? 'list';
      const args: string[] = [action];
      const key = input.contextKey?.trim();
      if (key !== undefined && key.length > 0) args.push(key);
      if (action === 'set') {
        const value = input.contextValue ?? input.prompt;
        args.push(value);
      }
      return { script: 'context.sh', args };
    }
    case 'detect':
      return { script: 'fusion.sh', args: ['detect', '--json'] };
    default: {
      const _ex: never = form;
      return _ex;
    }
  }
}