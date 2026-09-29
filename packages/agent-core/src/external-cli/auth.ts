import { spawn } from 'node:child_process';

import { detectExternalClis } from './detect';
import type { ExternalCliId } from './types';

export type ExternalCliLoginTarget = 'claude' | 'codex';

export interface ExternalCliLoginResult {
  readonly target: ExternalCliLoginTarget;
  readonly ok: boolean;
  readonly message: string;
  readonly exitCode: number | null;
}

/**
 * Drive the OAuth login flow for Claude Code or Codex by invoking their CLI.
 *
 * These CLIs own their OAuth clients, browser redirects, and token storage.
 * AndrewCode does not re-implement those flows — it launches them and reports
 * the outcome so Fusion panelists can authenticate.
 *
 * - Claude Code: `claude auth login` (falls back to `claude setup-token`)
 * - Codex: `codex login` (falls back to `codex login --device-auth`)
 */
export async function loginExternalCli(
  target: ExternalCliLoginTarget,
  options?: { readonly signal?: AbortSignal },
): Promise<ExternalCliLoginResult> {
  const detect = detectExternalClis();
  const probe = detect.providers[target];
  if (probe.status === 'missing') {
    const installHint =
      target === 'claude'
        ? 'Install Claude Code (https://code.claude.com/docs/en/setup), then re-run this command.'
        : 'Install Codex CLI (`npm i -g @openai/codex`), then re-run this command.';
    return {
      target,
      ok: false,
      message: `${target} CLI not found on PATH. ${installHint}`,
      exitCode: 127,
    };
  }

  const attempts =
    target === 'claude'
      ? [
          { bin: 'claude', args: ['auth', 'login'] },
          { bin: 'claude', args: ['setup-token'] },
        ]
      : [
          { bin: 'codex', args: ['login'] },
          { bin: 'codex', args: ['login', '--device-auth'] },
        ];

  let last: ExternalCliLoginResult | undefined;
  for (const attempt of attempts) {
    last = await runInteractive(attempt.bin, attempt.args, options?.signal);
    if (last.ok) {
      return {
        target,
        ok: true,
        message: `${target} OAuth login completed via \`${attempt.bin} ${attempt.args.join(' ')}\`.`,
        exitCode: last.exitCode,
      };
    }
    // Try next fallback only on command-not-found / bad usage, not on user cancel.
    if (last.exitCode === 0) break;
  }

  return {
    target,
    ok: false,
    message:
      last?.message ??
      `${target} OAuth login failed. Run \`${target === 'claude' ? 'claude auth login' : 'codex login'}\` manually.`,
    exitCode: last?.exitCode ?? 1,
  };
}

export function isExternalCliLoginTarget(value: string): value is ExternalCliLoginTarget {
  return value === 'claude' || value === 'codex';
}

/** Supported `login` subcommand targets, including the managed Kimi provider. */
export type LoginTarget = ExternalCliLoginTarget | 'kimi' | 'managed';

export function parseLoginTarget(raw?: string): LoginTarget {
  if (raw === undefined || raw === '' || raw === 'kimi' || raw === 'managed' || raw === 'kimi-code') {
    return 'kimi';
  }
  if (isExternalCliLoginTarget(raw)) return raw;
  throw new Error(
    `Unknown login target "${raw}". Use: kimi (default), claude, or codex.`,
  );
}

function runInteractive(
  bin: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<ExternalCliLoginResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, [...args], {
      stdio: 'inherit',
      windowsHide: false,
      shell: process.platform === 'win32',
      env: process.env,
    });

    const onAbort = (): void => {
      child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      resolve({
        target: bin === 'claude' ? 'claude' : 'codex',
        ok: false,
        message: `Failed to spawn ${bin}: ${err.message}`,
        exitCode: 127,
      });
    });

    child.on('close', (code) => {
      signal?.removeEventListener('abort', onAbort);
      const exitCode = code ?? 1;
      resolve({
        target: bin === 'claude' ? 'claude' : 'codex',
        ok: exitCode === 0,
        message:
          exitCode === 0
            ? 'ok'
            : `${bin} ${args.join(' ')} exited with code ${exitCode}`,
        exitCode,
      });
    });
  });
}

/** Quick status line for doctor / UI. */
export function formatExternalAuthStatus(): string {
  const detect = detectExternalClis();
  const lines: string[] = ['External CLI panelists (Fusion):'];
  for (const id of ['claude', 'codex', 'copilot', 'opencode', 'grok'] as ExternalCliId[]) {
    const p = detect.providers[id];
    lines.push(`  ${id}: ${p.status}${p.path ? ` (${p.path})` : ''}`);
  }
  lines.push(`  host: ${detect.host}`);
  lines.push(`  live panelists: ${detect.livePanelists}`);
  lines.push(
    'Login: `andrewcode login claude` or `andrewcode login codex` (also accepts `kimi login …`).',
  );
  return lines.join('\n');
}
