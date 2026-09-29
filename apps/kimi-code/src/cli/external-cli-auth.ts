/**
 * CLI-side bridges for Claude Code / Codex OAuth login and Fusion panelist probes.
 * Mirrors packages/agent-core/src/external-cli for the process entrypoint without
 * adding a direct apps/kimi-code → agent-core dependency.
 */

import { spawn, spawnSync } from 'node:child_process';

export type ExternalLoginTarget = 'claude' | 'codex' | 'perplexity' | 'xai' | 'kimi-platform';

export function parseLoginTarget(raw?: string): 'kimi' | ExternalLoginTarget {
  if (raw === undefined || raw === '' || raw === 'kimi' || raw === 'managed' || raw === 'kimi-code') {
    return 'kimi';
  }
  if (raw === 'kimi-platform' || raw === 'moonshot-cn' || raw === 'moonshot-ai') {
    return 'kimi-platform';
  }
  if (raw === 'claude' || raw === 'codex' || raw === 'perplexity' || raw === 'xai') return raw;
  throw new Error(
    `Unknown login target "${raw}". Use: kimi (Kimi Code OAuth), kimi-platform, xai, claude, codex, or perplexity.`,
  );
}

function which(binary: string): string | undefined {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [binary], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0) return undefined;
  return (result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

export function formatExternalAuthStatus(): string {
  const panelists = ['claude', 'codex', 'copilot', 'opencode', 'grok'] as const;
  const lines = ['External CLI panelists (Fusion):'];
  for (const id of panelists) {
    const path = which(id);
    lines.push(`  ${id}: ${path ? `available (${path})` : 'missing'}`);
  }
  lines.push(
    'Login: `andrewcode login` (Kimi Code) · `andrewcode login kimi-platform` · `andrewcode login --codex` · `andrewcode login xai` · `andrewcode login claude` · `andrewcode login perplexity`.',
  );
  return lines.join('\n');
}

export async function loginExternalCli(
  target: 'claude' | 'codex',
): Promise<{ ok: boolean; message: string; exitCode: number | null }> {
  const binaryPath = which(target);
  if (binaryPath === undefined) {
    const hint =
      target === 'claude'
        ? 'Install Claude Code (https://code.claude.com/docs/en/setup), then re-run.'
        : 'Install Codex CLI (`npm i -g @openai/codex`), then re-run.';
    return {
      ok: false,
      message: `${target} CLI not found on PATH. ${hint}`,
      exitCode: 127,
    };
  }

  const attempts: ReadonlyArray<readonly [string, readonly string[]]> =
    target === 'claude'
      ? [
          [binaryPath, ['auth', 'login']],
          [binaryPath, ['setup-token']],
        ]
      : [
          [binaryPath, ['login']],
          [binaryPath, ['login', '--device-auth']],
        ];

  let last: { ok: boolean; message: string; exitCode: number | null } | undefined;
  for (const [bin, args] of attempts) {
    last = await runInteractive(bin, args);
    if (last.ok) {
      return {
        ok: true,
        message: `${target} OAuth login completed via \`${target} ${args.join(' ')}\`.`,
        exitCode: last.exitCode,
      };
    }
  }

  return {
    ok: false,
    message:
      last?.message ??
      `${target} OAuth login failed. Run \`${target === 'claude' ? 'claude auth login' : 'codex login'}\` manually.`,
    exitCode: last?.exitCode ?? 1,
  };
}

function runInteractive(
  bin: string,
  args: readonly string[],
): Promise<{ ok: boolean; message: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(bin, [...args], {
      stdio: 'inherit',
      windowsHide: false,
      env: process.env,
    });
    child.on('error', (err) => {
      resolve({
        ok: false,
        message: `Failed to spawn ${bin}: ${err.message}`,
        exitCode: 127,
      });
    });
    child.on('close', (code) => {
      const exitCode = code ?? 1;
      resolve({
        ok: exitCode === 0,
        message: exitCode === 0 ? 'ok' : `${bin} ${args.join(' ')} exited with code ${exitCode}`,
        exitCode,
      });
    });
  });
}
