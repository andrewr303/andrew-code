import { describe, expect, it } from 'vitest';

import { buildLocalSpawnOptions } from '#/local';

// Regression coverage for the "bunch of popup console windows on Windows" bug.
//
// Node maps `detached` to DETACHED_PROCESS. Per the CreateProcess flag
// reference, CREATE_NO_WINDOW (Node's `windowsHide`) "is ignored ... if it is
// used with either CREATE_NEW_CONSOLE or DETACHED_PROCESS" — so a detached
// child loses the hide flag and runs with NO console, and every
// console-subsystem grandchild it spawns (git, gh, fd, rg, npm) allocates its
// OWN visible console window. `windowsHide` alone gives the child a hidden
// console that grandchildren inherit, which is what keeps the tree invisible.
//
// The flags are only observable on Windows, so we assert the builder directly.

const isWindows = process.platform === 'win32';

describe('buildLocalSpawnOptions (Windows console-window regression)', () => {
  it('sets windowsHide:true so the child gets a hidden console', () => {
    const options = buildLocalSpawnOptions('C:\repo', undefined);
    expect(options.windowsHide).toBe(true);
  });

  it('never sets detached on Windows, so windowsHide is not discarded', () => {
    const options = buildLocalSpawnOptions('C:\repo', undefined);
    expect(options.detached).toBe(!isWindows);
  });

  it.runIf(!isWindows)('keeps detached on POSIX for process-group tree kills', () => {
    expect(buildLocalSpawnOptions('/repo', undefined).detached).toBe(true);
  });

  it('pipes stdin/stdout/stderr and forwards cwd + env', () => {
    const env = { FOO: 'bar' };
    const options = buildLocalSpawnOptions('/repo', env);
    expect(options.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    expect(options.cwd).toBe('/repo');
    expect(options.env).toBe(env);
  });
});
