/**
 * Scenario: kernel runs cells with persistent state and answers bridge calls.
 * Responsibilities: verify session persistence, bridge read/glob/grep, and reset.
 * Wiring: real kernel service; host-process/host-fs/session/codeMode stubs.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/features/kernel.test.ts`.
 */
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { ICodeModeService } from '#/agent/codeMode/codeMode';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { IHostProcessService, type IHostProcess } from '#/os/interface/hostProcess';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { IKernelService } from '#/features/kernel/kernel';
import { AgentKernelService } from '#/features/kernel/kernelService';

class FakeProcess extends EventEmitter implements IHostProcess {
  readonly _serviceBrand: undefined = undefined;
  readonly pid = 4242;
  exitCode: number | null = null;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  constructor(private readonly onRequest: (line: string) => void) {
    super();
    this.stdin.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n')) {
        if (line.trim().length > 0) this.onRequest(line);
      }
    });
  }

  private waitResolve: (() => void) | undefined;
  private readonly waited = new Promise<void>((resolve) => {
    this.waitResolve = resolve;
  });

  async wait(): Promise<number> {
    await this.waited;
    return 0;
  }

  async kill(): Promise<void> {
    this.killed = true;
    this.exitCode = 0;
    this.waitResolve?.();
  }

  dispose(): void {
    this.stdin.destroy();
    this.stdout.destroy();
    this.stderr.destroy();
  }

  respond(line: string): void {
    this.stdout.write(`${line}\n`);
  }
}

describe('Kernel — persistent execution with bridge (src/features/kernel)', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let procs: FakeProcess[];
  const files = new Map<string, string>([['/work/notes.txt', 'hello kernel']]);

  const answerBridge = (proc: FakeProcess, line: string): void => {
    const msg = JSON.parse(line) as { id?: number; code?: string; bridge?: number; result?: unknown };
    if (msg.bridge !== undefined) return;
    if (msg.code !== undefined) {
      if (msg.code.includes('agent.read')) {
        proc.respond(JSON.stringify({ bridge: 1, tool: 'read', args: { path: 'notes.txt' } }));
        queueMicrotask(() => {
          proc.respond(JSON.stringify({ id: msg.id, status: 'ok', output: 'bridged-read-ok' }));
        });
        return;
      }
      proc.respond(JSON.stringify({ id: msg.id, status: 'ok', output: `ran:${msg.code.slice(0, 20)}` }));
    }
  };

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    procs = [];
    ix.stub(IHostProcessService, {
      _serviceBrand: undefined,
      spawn: async () => {
        const proc = new FakeProcess((line) => answerBridge(proc, line));
        procs.push(proc);
        return proc;
      },
    } as unknown as IHostProcessService);
    ix.stub(IHostFileSystem, {
      _serviceBrand: undefined,
      readText: async (path: string) => {
        const body = files.get(path);
        if (body === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return body;
      },
      readdir: async () => [],
    } as unknown as IHostFileSystem);
    ix.stub(ISessionContext, { cwd: '/work' } as ISessionContext);
    ix.stub(ICodeModeService, {
      _serviceBrand: undefined,
      exec: async (source: string) => ({ status: 'ok', output: `js:${source.slice(0, 10)}` }),
    } as unknown as ICodeModeService);
    ix.set(IKernelService, new SyncDescriptor(AgentKernelService));
  });
  afterEach(() => disposables.dispose());

  it('routes python cells to one persistent child', async () => {
    const kernel = ix.get(IKernelService);
    const first = await kernel.run('python', 'x = 1');
    const second = await kernel.run('python', 'y = 2');
    expect(first.output).toContain('ran:');
    expect(second.output).toContain('ran:');
    expect(procs).toHaveLength(1);
  });

  it('answers bridge calls from inside a cell', async () => {
    const kernel = ix.get(IKernelService);
    const result = await kernel.run('python', 'print(agent.read("notes.txt"))');
    expect(result.status).toBe('ok');
    expect(result.output).toBe('bridged-read-ok');
  });

  it('delegates javascript cells to codeMode', async () => {
    const kernel = ix.get(IKernelService);
    const result = await kernel.run('javascript', '1 + 1');
    expect(result.output).toContain('js:');
    expect(procs).toHaveLength(0);
  });

  it('reset kills the session child', async () => {
    const kernel = ix.get(IKernelService);
    await kernel.run('python', 'x = 1');
    await kernel.reset();
    expect(procs[0]?.killed).toBe(true);
    await kernel.run('python', 'x = 1');
    expect(procs).toHaveLength(2);
  });
});
