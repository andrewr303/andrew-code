import { spawnSync } from 'node:child_process';

import type { Command } from 'commander';

import { resolveCommandPath } from '#/utils/process/resolve-command';

export const BSK_MISSING_MESSAGE = [
  'The `bsk` CLI was not found on PATH.',
  'Install it first: https://raw.githubusercontent.com/Tencent/BrowserSkill/main/AGENT_INSTALL.md',
  'Then launch Chrome, open the BrowserSkill extension popup until it turns green, and re-run `bsk doctor`.',
  '',
].join('\n');

export interface BrowserDeps {
  readonly resolveBsk?: () => string | undefined;
  readonly spawn?: (
    bskPath: string,
    args: readonly string[],
  ) => { status: number | null; error?: unknown };
  readonly stdout: { write(chunk: string): boolean };
  readonly stderr: { write(chunk: string): boolean };
  readonly exit: (code: number) => never;
}

function resolveDeps(deps: Partial<BrowserDeps> | undefined): {
  resolveBsk: () => string | undefined;
  spawn: (bskPath: string, args: readonly string[]) => { status: number | null; error?: unknown };
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  exit: (code: number) => never;
} {
  return {
    resolveBsk: deps?.resolveBsk ?? (() => resolveCommandPath('bsk')),
    spawn:
      deps?.spawn ??
      ((bskPath, args) => {
        const result = spawnSync(bskPath, [...args], { stdio: 'inherit', windowsHide: true });
        return { status: result.status, error: result.error };
      }),
    stdout: deps?.stdout ?? process.stdout,
    stderr: deps?.stderr ?? process.stderr,
    exit: deps?.exit ?? ((code: number) => process.exit(code)),
  };
}

/**
 * Forward argv to the `bsk` browser-control CLI, resolved through PATH so a
 * binary planted in the workspace can never run before the trust gate.
 * Returns the child exit code instead of exiting when deps.exit is stubbed
 * by throwing (tests); the real exit never returns.
 */
export function handleBrowser(
  deps: Partial<BrowserDeps> | undefined,
  args: readonly string[],
): number {
  const resolved = resolveDeps(deps);
  const bskPath = resolved.resolveBsk();
  if (bskPath === undefined) {
    resolved.stderr.write(BSK_MISSING_MESSAGE);
    resolved.exit(1);
    return 1;
  }
  const result = resolved.spawn(bskPath, args);
  if (result.error !== undefined) {
    resolved.stderr.write(
      `Failed to run \`bsk\`: ${result.error instanceof Error ? result.error.message : String(result.error)}\n`,
    );
    resolved.exit(1);
    return 1;
  }
  const code = result.status ?? 1;
  if (code !== 0) resolved.exit(code);
  return code;
}

export function registerBrowserCommand(parent: Command, deps?: Partial<BrowserDeps>): void {
  parent
    .command('browser')
    .description('Control Chrome via the bsk CLI (navigate, observe, click, fill, screenshot, QA).')
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .argument('[args...]', 'Arguments forwarded to `bsk`. Run `andrewcode browser --help` to list them.')
    .action((args: string[]) => {
      handleBrowser(deps, args);
    });
}
