import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { runProcess } from './dispatch';
import { resolveFusionRoot } from './paths';
import type {
  ExternalCliId,
  FusionBoardVerb,
  FusionContextAction,
  FusionMode,
  ScriptForm,
} from './types';

export interface ResolveFusionScriptsOptions {
  readonly customRoot?: string;
  readonly homeDir?: string;
  readonly env?: Record<string, string | undefined>;
  readonly skipRepoFallback?: boolean;
}

export interface ScriptFormCommandInput {
  readonly mode: FusionMode;
  readonly prompt?: string;
  readonly captains?: readonly ExternalCliId[];
  readonly children_per_captain?: number;
  readonly layers?: number;
  readonly dry_run?: boolean;
  readonly verb?: 'doctor' | 'test' | 'launch' | 'status' | 'install';
  readonly plan_file?: string;
  readonly providers?: readonly ExternalCliId[];
  readonly pattern?: string;
  readonly thinking_effort?: string;
  readonly board_verb?: FusionBoardVerb;
  readonly board_db?: string;
  readonly context_action?: FusionContextAction;
  readonly context_key?: string;
  readonly context_value?: string;
}

export interface ScriptFormCommandResult {
  readonly script: string;
  readonly args: string[];
}

export interface FusionScriptResult {
  readonly script: string;
  readonly args: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly error?: string;
}

const SCRIPT_FORMS: ReadonlySet<FusionMode> = new Set<FusionMode>([
  'graph',
  'hive',
  'designer',
  'metaloop',
  'ultracode',
  'ultraswarm',
  'board',
  'context',
]);

/** Check if mode is one of the script-backed swarm forms. */
export function isScriptMode(mode: FusionMode): mode is ScriptForm {
  return SCRIPT_FORMS.has(mode);
}

/** Cross-platform which probe. */
export function which(binary: string): string | undefined {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [binary], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0) return undefined;
  const first = (result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return first;
}

/** Resolve bash interpreter path. */
export function resolveBashPath(): string {
  if (process.platform === 'win32') {
    const gitBash = which('bash');
    if (gitBash) return gitBash;
  }
  return 'bash';
}

function resolveRepoSwarmScripts(): string | undefined {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 12; i++) {
    const cand = join(dir, 'swarm', 'scripts');
    if (existsSync(join(cand, 'swarm.sh')) || existsSync(join(cand, 'fusion.sh'))) {
      return cand;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/**
 * Resolve the directory holding Fusion bash scripts (`fusion.sh`, `swarm.sh`, `ultracode.sh`).
 *
 * Precedence:
 * 1. Explicit `options.customRoot` (if exists)
 * 2. `FUSION_SCRIPTS_ROOT` or `FUSION_PLUGIN_ROOT` env
 * 3. `~/.andrewcode/plugins/managed/fusion/scripts`
 * 4. `~/.claude/plugins/fusion/scripts`
 * 5. Monorepo fallback (`fusion/scripts`, `swarm/scripts`)
 */
export function resolveFusionScriptsRoot(
  options?: ResolveFusionScriptsOptions,
): string | undefined {
  if (options?.customRoot && existsSync(options.customRoot)) {
    return resolve(options.customRoot);
  }

  const env = options?.env ?? process.env;
  const fromEnv = (
    env['FUSION_SCRIPTS_ROOT'] ??
    env['FUSION_PLUGIN_ROOT']
  )?.trim();

  if (fromEnv) {
    const scriptsSub = join(fromEnv, 'scripts');
    if (existsSync(scriptsSub)) {
      return resolve(scriptsSub);
    }
    if (existsSync(fromEnv)) {
      return resolve(fromEnv);
    }
  }

  const home = options?.homeDir ?? env['HOME'] ?? env['USERPROFILE'] ?? '.';
  const candidate1 = join(home, '.andrewcode', 'plugins', 'managed', 'fusion', 'scripts');
  if (existsSync(candidate1)) {
    return resolve(candidate1);
  }

  const candidate2 = join(home, '.claude', 'plugins', 'fusion', 'scripts');
  if (existsSync(candidate2)) {
    return resolve(candidate2);
  }

  if (options?.skipRepoFallback !== true) {
    const root = resolveFusionRoot();
    if (root) {
      const scriptsSub = join(root, 'scripts');
      if (existsSync(scriptsSub)) {
        return resolve(scriptsSub);
      }
    }
    const swarmScripts = resolveRepoSwarmScripts();
    if (swarmScripts) {
      return swarmScripts;
    }
  }

  return undefined;
}

/**
 * Map high-level swarm form inputs to script command invocations.
 */
function resolveBoardDb(explicit?: string): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  const env = process.env['FUSION_BOARD']?.trim();
  if (env) return env;
  const state = process.env['FUSION_STATE_DIR']?.trim();
  const root = state ? state : join(homedir(), '.fusion');
  return join(root, 'hive', 'board.sqlite');
}

export function scriptFormCommand(input: ScriptFormCommandInput): ScriptFormCommandResult {
  const task = input.prompt?.trim() ?? '';

  switch (input.mode) {
    case 'hive': {
      const args: string[] = ['hive', task];
      const captains =
        input.captains && input.captains.length > 0 ? input.captains : input.providers;
      if (captains && captains.length > 0) {
        args.push('--captains', captains.join(','));
      }
      if (input.children_per_captain !== undefined) {
        args.push('--children', String(input.children_per_captain));
      }
      if (input.dry_run) {
        args.push('--dry-run');
      }
      return { script: 'swarm.sh', args };
    }
    case 'graph': {
      const args: string[] = ['graph', task, input.dry_run ? '--plan' : '--json'];
      return { script: 'swarm.sh', args };
    }
    case 'designer': {
      const args: string[] = task ? ['designer', task] : ['designer'];
      return { script: 'swarm.sh', args };
    }
    case 'metaloop': {
      const args: string[] = ['metaloop', task];
      if (input.plan_file) {
        args.push('--plan-file', input.plan_file);
      }
      return { script: 'swarm.sh', args };
    }
    case 'ultracode': {
      const verb = input.verb ?? 'doctor';
      return { script: 'ultracode.sh', args: [verb] };
    }
    case 'ultraswarm': {
      return {
        script: 'ultraswarm.sh',
        args: task.length > 0 && task !== '--discover' ? ['--non-interactive', '--task', task] : ['--discover'],
      };
    }
    case 'board': {
      const verb: FusionBoardVerb = input.board_verb ?? 'agents';
      const args: string[] = ['--db', resolveBoardDb(input.board_db), verb];
      if ((verb === 'poll' || verb === 'mentions') && task.length > 0) {
        args.push('--agent', task);
      }
      return { script: 'board.sh', args };
    }
    case 'context': {
      const action: FusionContextAction = input.context_action ?? 'list';
      const args: string[] = [action];
      const key = input.context_key?.trim();
      if (key && (action === 'get' || action === 'set' || action === 'clear')) {
        args.push(key);
      }
      if (action === 'set' && input.context_value !== undefined) {
        args.push(input.context_value);
      }
      return { script: 'context.sh', args };
    }
    case 'detect': {
      return { script: 'fusion.sh', args: ['detect', '--json'] };
    }
    case 'swarm': {
      const pattern = input.pattern ?? 'moa';
      const args: string[] = [pattern, task];
      if (input.layers !== undefined) {
        args.push('--layers', String(input.layers));
      }
      if (input.dry_run) {
        args.push('--json');
      }
      return { script: 'swarm.sh', args };
    }
    default: {
      return { script: 'fusion.sh', args: [input.mode, task] };
    }
  }
}

/**
 * Execute a Fusion script with timeout and signal management.
 */
export async function runFusionScript(options: {
  readonly script: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly scriptsRoot?: string;
  readonly env?: Record<string, string | undefined>;
}): Promise<FusionScriptResult> {
  const scriptsRoot = options.scriptsRoot ?? resolveFusionScriptsRoot();
  if (!scriptsRoot) {
    throw new Error(
      'Fusion scripts bundle not found. Set FUSION_PLUGIN_ROOT to your fusion directory or install the fusion plugin.',
    );
  }

  const scriptPath = isAbsolute(options.script)
    ? options.script
    : join(scriptsRoot, options.script);

  const bash = resolveBashPath();
  const args = [scriptPath, ...options.args];
  const timeoutMs = options.timeoutMs ?? 900_000;

  const result = await runProcess({
    bin: bash,
    args,
    cwd: options.cwd ?? process.cwd(),
    timeoutMs,
    signal: options.signal,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });

  return {
    script: options.script,
    args: options.args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    error: result.error,
  };
}
