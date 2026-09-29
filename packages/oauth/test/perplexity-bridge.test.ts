import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PERPLEXITY_BRIDGE_HOST,
  startPerplexityBridge,
} from '../src/perplexity-bridge';

function healthyFetch(): typeof fetch {
  return (async () =>
    new Response(JSON.stringify({ status: 'healthy' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

function hangingFetch(): typeof fetch {
  return ((_input: string | URL | Request) => new Promise<Response>(() => {})) as typeof fetch;
}

class FakeChild extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly killed: string[] = [];

  kill(signal?: NodeJS.Signals): boolean {
    this.killed.push(signal ?? 'SIGTERM');
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit('exit', 0, null);
    });
    return true;
  }
}

describe('startPerplexityBridge', () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it('errors when the pwm binary is missing', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'andrewcode-pwm-no-bin-'));
    tempDirs.push(emptyDir);
    const previousPath = process.env['PATH'];
    process.env['PATH'] = emptyDir;
    try {
      await expect(
        startPerplexityBridge({
          fetchImpl: healthyFetch(),
          spawnImpl: (() => {
            throw new Error('unreachable');
          }) as never,
        }),
      ).rejects.toThrow(/pwm.*PATH/);
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });

  it('spawns pwm api on loopback with a numeric port and waits for health', async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => {
        child.emit('spawn');
      });
      return child as unknown as ChildProcess;
    });
    const fetchImpl = vi.fn(healthyFetch());

    const handle = await startPerplexityBridge({
      binaryPath: '/usr/local/bin/pwm',
      fetchImpl,
      spawnImpl: spawnImpl as never,
    });

    expect(spawnImpl).toHaveBeenCalledOnce();
    const firstCall = spawnImpl.mock.calls[0] as unknown as [string, readonly string[]] | undefined;
    if (firstCall === undefined) throw new Error('spawn was not called');
    const [binary, args] = firstCall;
    expect(binary).toBe('/usr/local/bin/pwm');
    expect(args[0]).toBe('api');
    expect(args).toContain('--host');
    expect(args).toContain(PERPLEXITY_BRIDGE_HOST);
    expect(args).toContain('--port');
    const portIndex = args.indexOf('--port');
    const port = Number(args[portIndex + 1]);
    expect(Number.isInteger(port) && port > 0).toBe(true);
    expect(handle.baseUrl).toBe(`http://${PERPLEXITY_BRIDGE_HOST}:${String(port)}`);
    expect(fetchImpl).toHaveBeenCalledWith(`${handle.baseUrl}/health`);

    await handle.stop();
    expect(child.killed).toContain('SIGTERM');
  });

  it('kills the child when health never becomes ready', async () => {
    const child = new FakeChild();
    const spawnImpl = vi.fn(() => {
      queueMicrotask(() => {
        child.emit('spawn');
      });
      return child as unknown as ChildProcess;
    });

    await expect(
      startPerplexityBridge({
        binaryPath: 'pwm',
        fetchImpl: hangingFetch(),
        healthTimeoutMs: 600,
        spawnImpl: spawnImpl as never,
      }),
    ).rejects.toThrow(/Timed out waiting/);
    expect(child.killed.length).toBeGreaterThan(0);
  });

  it('surfaces an immediate spawn failure', async () => {
    const spawnImpl = vi.fn(() => {
      throw new Error('spawn ENOENT');
    });
    await expect(
      startPerplexityBridge({
        binaryPath: 'pwm',
        fetchImpl: healthyFetch(),
        spawnImpl: spawnImpl as never,
      }),
    ).rejects.toThrow(/Failed to start/);
  });
});
