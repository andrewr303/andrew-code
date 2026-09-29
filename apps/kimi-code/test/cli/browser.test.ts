import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

import { BSK_MISSING_MESSAGE, handleBrowser, registerBrowserCommand } from '#/cli/sub/browser';

function makeDeps() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const exitCodes: number[] = [];
  const spawn = vi.fn(
    (_bskPath: string, _args: readonly string[]): { status: number | null; error?: unknown } => ({
      status: 0,
    }),
  );
  return {
    deps: {
      resolveBsk: () => '/usr/local/bin/bsk' as string | undefined,
      spawn,
      stdout: { write: (chunk: string) => stdout.push(chunk) > 0 },
      stderr: { write: (chunk: string) => stderr.push(chunk) > 0 },
      exit: (code: number) => {
        exitCodes.push(code);
        throw new Error(`exit ${String(code)}`);
      },
    },
    spawn,
    stdout,
    stderr,
    exitCodes,
  };
}

describe('andrewcode browser', () => {
  it('forwards argv to the resolved bsk binary', () => {
    const { deps, spawn, exitCodes } = makeDeps();

    const code = handleBrowser(deps, ['observe', '--session', 'abcd']);

    expect(code).toBe(0);
    expect(exitCodes).toEqual([]);
    expect(spawn).toHaveBeenCalledWith('/usr/local/bin/bsk', ['observe', '--session', 'abcd']);
  });

  it('propagates a non-zero bsk exit code', () => {
    const { deps, spawn, exitCodes } = makeDeps();
    spawn.mockReturnValue({ status: 2 });

    expect(() => handleBrowser(deps, ['doctor'])).toThrow('exit 2');
    expect(exitCodes).toEqual([2]);
  });

  it('reports a spawn failure as exit 1', () => {
    const { deps, spawn, stderr, exitCodes } = makeDeps();
    spawn.mockReturnValue({ status: null, error: new Error('boom') });

    expect(() => handleBrowser(deps, ['doctor'])).toThrow('exit 1');
    expect(exitCodes).toEqual([1]);
    expect(stderr.join('')).toContain('Failed to run `bsk`');
  });

  it('errors clearly when bsk is missing from PATH', () => {
    const { deps, spawn, stderr, exitCodes } = makeDeps();

    expect(() =>
      handleBrowser({ ...deps, resolveBsk: () => undefined }, ['doctor']),
    ).toThrow('exit 1');
    expect(exitCodes).toEqual([1]);
    expect(spawn).not.toHaveBeenCalled();
    expect(stderr.join('')).toContain(BSK_MISSING_MESSAGE.split('\n')[0]);
  });

  it('registers a browser command that forwards through commander', () => {
    const { deps, spawn, exitCodes } = makeDeps();
    const program = new Command('andrewcode');
    registerBrowserCommand(program, deps);

    void program.parseAsync(['node', 'andrewcode', 'browser', 'navigate', 'http://example.test']);

    expect(spawn).toHaveBeenCalledWith('/usr/local/bin/bsk', [
      'navigate',
      'http://example.test',
    ]);
    expect(exitCodes).toEqual([]);
  });
});
