import { ChildProcess, spawn, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { installWindowsNoConsole } from '#/utils/process/windows-no-console';

const isWindows = process.platform === 'win32';

/**
 * The backstop patches `ChildProcess.prototype.spawn` (async spawns) and the
 * native `spawn_sync` binding (sync spawns), so the only way to observe it
 * is to hand each surface an options object and read back what it rewrote.
 * We reach the patched surfaces the same way Node's `child_process` does.
 */
type ObservedOptions = { detached?: boolean; windowsHide?: boolean };

function nativeSpawnSyncOptions(overrides: ObservedOptions): ObservedOptions {
  const binding = (process as unknown as { binding(name: string): { spawn: (o: unknown) => unknown } }).binding(
    'spawn_sync',
  );
  const options: ObservedOptions & Record<string, unknown> = {
    file: process.execPath,
    args: [process.execPath, '-e', ''],
    envPairs: [],
    stdio: [
      { type: 'ignore' },
      { type: 'ignore' },
      { type: 'ignore' },
    ],
    ...overrides,
  };
  try {
    binding.spawn(options);
  } catch {
    // A rejected options shape still went through the patch, which is all we
    // are asserting on.
  }
  return options;
}

describe('installWindowsNoConsole', () => {
  it('leaves spawning functional', () => {
    installWindowsNoConsole();
    const result = spawnSync(process.execPath, ['-e', 'process.stdout.write("ok")'], {
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  it.runIf(isWindows)('forces windowsHide true when the caller omitted it', () => {
    installWindowsNoConsole();
    expect(nativeSpawnSyncOptions({}).windowsHide).toBe(true);
  });

  // The regression that produced bursts of popup windows: DETACHED_PROCESS
  // makes Windows ignore CREATE_NO_WINDOW, so the child runs with no console
  // and every console-subsystem grandchild allocates its own visible one.
  it.runIf(isWindows)('clears detached, which would otherwise discard windowsHide', () => {
    installWindowsNoConsole();
    const options = nativeSpawnSyncOptions({ detached: true, windowsHide: true });
    expect(options.detached).toBe(false);
    expect(options.windowsHide).toBe(true);
  });

  it.runIf(isWindows)('clears detached even when the caller opted out of hiding', () => {
    installWindowsNoConsole();
    expect(nativeSpawnSyncOptions({ detached: true, windowsHide: false }).detached).toBe(false);
  });

  // Regression: newer Node passes positional arguments (executable path
  // first) to the process_wrap binding, which made the old binding-level
  // patch throw "Cannot create property 'windowsHide' on string" and kill
  // every async spawn in the process.
  it('leaves async spawning functional', async () => {
    installWindowsNoConsole();
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', 'process.stdout.write("ok")']);
      let output = '';
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        output += chunk;
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve(output);
        else reject(new Error(`async spawn exited with code ${code}`));
      });
    });
    expect(stdout).toBe('ok');
  });

  it.runIf(isWindows)('forces windowsHide on the async path via ChildProcess.prototype.spawn', () => {
    installWindowsNoConsole();
    // Reach the patched prototype the same way child_process.spawn does.
    const child = new ChildProcess();
    child.on('error', () => {});
    const options: ObservedOptions & Record<string, unknown> = {
      file: process.execPath,
      args: [process.execPath, '-e', ''],
      envPairs: [],
      stdio: 'ignore',
      detached: true,
    };
    try {
      (child as unknown as { spawn(options: unknown): unknown }).spawn(options);
    } catch {
      // A rejected options shape still went through the patch, which is
      // all we are asserting on.
    }
    expect(options.detached).toBe(false);
    expect(options.windowsHide).toBe(true);
  });
});
