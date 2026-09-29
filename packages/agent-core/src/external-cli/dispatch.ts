import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAcpSession } from './acp-session';
import type {
  ExternalCliDispatchRequest,
  ExternalCliDispatchResult,
  ExternalCliId,
} from './types';

const DEFAULT_TIMEOUT_MS = 900_000;

/**
 * Dispatch a single external coding CLI with a one-shot prompt.
 *
 * Output is captured from stdout (and, when the CLI writes a file, that file).
 * Panelists run with their own OAuth credentials already stored by their CLI.
 */
export async function dispatchExternalCli(
  request: ExternalCliDispatchRequest,
): Promise<ExternalCliDispatchResult> {
  const started = Date.now();
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cwd = request.cwd ?? process.cwd();

  const scratch = mkdtempSync(join(tmpdir(), `andrew-fusion-${request.provider}-`));
  const promptFile = join(scratch, 'prompt.txt');
  const outFile = join(scratch, 'out.txt');
  writeFileSync(promptFile, request.prompt, 'utf8');
  writeFileSync(outFile, '', 'utf8');

  try {
    const acp = await runAcpSession({
      provider: request.provider,
      prompt: request.prompt,
      cwd,
      timeoutMs,
      signal: request.signal,
    });
    if (acp.usedAcp && acp.output.trim().length > 0) {
      return {
        provider: request.provider,
        status: 'returned',
        output: `[acp]\n${acp.output.trim()}`,
        ms: Date.now() - started,
        exitCode: acp.exitCode,
      };
    }

    const { bin, args, useStdin } = buildCommand(request.provider, {
      promptFile,
      outFile,
      model: request.model,
      effort: request.effort,
      prompt: request.prompt,
    });

    const result = await runProcess({
      bin,
      args,
      cwd,
      timeoutMs,
      signal: request.signal,
      stdin: useStdin ? request.prompt : undefined,
    });

    let output = result.stdout.trim();
    if (output.length === 0) {
      try {
        output = readFileSync(outFile, 'utf8').trim();
      } catch {
        // no file output
      }
    }
    if (output.length === 0 && result.stderr.trim().length > 0) {
      output = result.stderr.trim();
    }

    const ms = Date.now() - started;
    if (result.timedOut) {
      return {
        provider: request.provider,
        status: 'timeout',
        output,
        ms,
        error: `timed out after ${timeoutMs}ms`,
        exitCode: result.exitCode,
      };
    }
    if (result.error !== undefined) {
      return {
        provider: request.provider,
        status: 'error',
        output,
        ms,
        error: result.error,
        exitCode: result.exitCode,
      };
    }
    if (result.exitCode !== 0 || output.length === 0) {
      return {
        provider: request.provider,
        status: 'absent',
        output,
        ms,
        error:
          result.stderr.trim() ||
          `exit ${result.exitCode}${output.length === 0 ? ', empty output' : ''}`,
        exitCode: result.exitCode,
      };
    }
    return {
      provider: request.provider,
      status: 'returned',
      output,
      ms,
      exitCode: result.exitCode,
    };
  } finally {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

function buildCommand(
  provider: ExternalCliId,
  opts: {
    readonly promptFile: string;
    readonly outFile: string;
    readonly model?: string | undefined;
    readonly effort?: string | undefined;
    readonly prompt: string;
  },
): { bin: string; args: string[]; useStdin: boolean } {
  switch (provider) {
    case 'codex': {
      const model = opts.model ?? process.env['FUSION_CODEX_MODEL'] ?? 'gpt-5.5';
      const effort = opts.effort ?? process.env['FUSION_CODEX_EFFORT'] ?? 'xhigh';
      return {
        bin: 'codex',
        args: [
          'exec',
          '--skip-git-repo-check',
          '--ephemeral',
          '--color',
          'never',
          '-s',
          process.env['FUSION_CODEX_SANDBOX'] ?? 'workspace-write',
          '-m',
          model,
          '-c',
          `model_reasoning_effort=${effort}`,
          '-o',
          opts.outFile,
          '-',
        ],
        useStdin: true,
      };
    }
    case 'claude': {
      // Claude Code print mode: non-interactive one-shot.
      const model = opts.model ?? process.env['FUSION_CLAUDE_MODEL'];
      const args = ['-p', opts.prompt, '--output-format', 'text'];
      if (model) args.push('--model', model);
      return { bin: 'claude', args, useStdin: false };
    }
    case 'kimi':
    case 'andrewcode': {
      const bin = provider === 'andrewcode' ? 'andrewcode' : 'kimi';
      const model = opts.model ?? process.env['FUSION_KIMI_MODEL'];
      const args = ['-p', opts.prompt, '--output-format', 'text'];
      if (model) args.push('-m', model);
      return { bin, args, useStdin: false };
    }
    case 'opencode': {
      const model = opts.model ?? process.env['FUSION_OPENCODE_MODEL'];
      const args = ['run', opts.prompt];
      if (model) args.push('--model', model);
      return { bin: 'opencode', args, useStdin: false };
    }
    case 'grok': {
      const model = opts.model ?? process.env['FUSION_GROK_MODEL'];
      const args = ['-p', opts.prompt];
      if (model) args.push('-m', model);
      return { bin: 'grok', args, useStdin: false };
    }
    case 'copilot': {
      // GitHub Copilot CLI — best-effort non-interactive shape.
      return {
        bin: 'copilot',
        args: ['-p', opts.prompt],
        useStdin: false,
      };
    }
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

export interface ProcessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly error?: string;
}

export function runProcess(options: {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal | undefined;
  readonly stdin?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
}): Promise<ProcessResult> {
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const child = spawn(options.bin, [...options.args], {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      shell: false,
      stdio: options.stdin !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
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

    const finish = (result: ProcessResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    child.on('error', (err) => {
      finish({
        stdout,
        stderr,
        exitCode: 127,
        timedOut: false,
        error: err.message,
      });
    });

    child.on('close', (code) => {
      finish({
        stdout,
        stderr,
        exitCode: code ?? 1,
        timedOut,
      });
    });
  });
}
