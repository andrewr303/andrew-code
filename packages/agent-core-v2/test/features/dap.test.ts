/**
 * Scenario: debug sessions — launch through a DAP adapter, inspect, and stop.
 * Responsibilities: verify frame codec, session lifecycle, command forwarding, and error paths.
 * Wiring: real codec + DapSession + AgentDebugService; fake adapter process over PassThrough.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/features/dap.test.ts`.
 */
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { IHostProcessService, type IHostProcess } from '#/os/interface/hostProcess';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { DapFrameDecoder, encodeDapMessage, adapterForFile } from '#/features/dap/dapCodec';
import { IDebugService } from '#/features/dap/debug';
import { AgentDebugService } from '#/features/dap/debugService';

class FakeDapProcess implements IHostProcess {
  readonly _serviceBrand: undefined = undefined;
  readonly pid = 9002;
  exitCode: number | null = null;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  disposed = false;
  readonly received: string[] = [];

  constructor() {
    this.stdin.on('data', (chunk: Buffer) => {
      let text = String(chunk);
      let boundary = this.findFrame(text);
      while (boundary !== undefined) {
        const body = text.slice(boundary.start, boundary.end);
        this.received.push(body);
        const message = JSON.parse(body) as { seq: number; command: string; id?: number };
        this.answer(message.seq, message.command);
        text = text.slice(boundary.end);
        boundary = this.findFrame(text);
      }
    });
  }

  private findFrame(text: string): { start: number; end: number } | undefined {
    const headerEnd = text.indexOf('\r\n\r\n');
    if (headerEnd < 0) return undefined;
    const match = /Content-Length:\s*(\d+)/i.exec(text.slice(0, headerEnd));
    if (match === null) return undefined;
    const start = headerEnd + 4;
    const end = start + Number.parseInt(match[1]!, 10);
    if (text.length < end) return undefined;
    return { start, end };
  }

  private answer(requestSeq: number, command: string): void {
    let seq = requestSeq * 100;
    switch (command) {
      case 'initialize':
      case 'launch':
      case 'attach':
      case 'continue':
      case 'pause':
        this.stdout.write(
          encodeDapMessage({ seq: seq++, type: 'response', request_seq: requestSeq, success: true, command, body: {} }),
        );
        return;
      case 'stackTrace':
        this.stdout.write(
          encodeDapMessage({
            seq: seq++,
            type: 'response',
            request_seq: requestSeq,
            success: true,
            command,
            body: {
              stackFrames: [{ id: 1, name: 'xorshift32', line: 6, column: 10, source: { path: '/work/demo.c' } }],
            },
          }),
        );
        return;
      case 'evaluate':
        this.stdout.write(
          encodeDapMessage({
            seq: seq++,
            type: 'response',
            request_seq: requestSeq,
            success: true,
            command,
            body: { result: '57351', variablesReference: 0 },
          }),
        );
        return;
      case 'disconnect':
      default:
        this.stdout.write(
          encodeDapMessage({ seq: seq++, type: 'response', request_seq: requestSeq, success: true, command, body: {} }),
        );
    }
  }

  async wait(): Promise<number> {
    return 0;
  }

  async kill(): Promise<void> {
    this.disposed = true;
  }

  dispose(): void {
    this.disposed = true;
    this.stdin.destroy();
    this.stdout.destroy();
    this.stderr.destroy();
  }
}

describe('dap — real debugger sessions (src/features/dap)', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IHostProcessService, {
      _serviceBrand: undefined,
      spawn: async () => new FakeDapProcess(),
    } as unknown as IHostProcessService);
    ix.stub(ISessionContext, { cwd: '/work' } as ISessionContext);
    ix.set(IDebugService, new SyncDescriptor(AgentDebugService));
  });
  afterEach(() => disposables.dispose());

  it('frame decoder round-trips DAP messages', () => {
    const decoder = new DapFrameDecoder();
    const frame = encodeDapMessage({ seq: 1, type: 'response', request_seq: 1, success: true, command: 'x', body: { ok: 1 } });
    const messages = [frame.slice(0, 5), frame.slice(5)].flatMap((chunk) => decoder.push(chunk));
    expect(messages).toEqual([
      { seq: 1, type: 'response', request_seq: 1, success: true, command: 'x', body: { ok: 1 } },
    ]);
  });

  it('resolves adapters by file type', () => {
    expect(adapterForFile('/work/demo.py')?.id).toBe('debugpy');
    expect(adapterForFile('/work/demo.c')?.id).toBe('lldb-dap');
    expect(adapterForFile('/work/svc.go')?.id).toBe('dlv');
    expect(adapterForFile('/work/notes.txt')).toBeUndefined();
  });

  it('launches, reads the stack, evaluates, then stops', async () => {
    const debug = ix.get(IDebugService);
    const start = await debug.start('native', { kind: 'launch', program: '/work/demo.c', stopOnEntry: true });
    expect(start.body).toEqual({});
    expect(debug.isActive('native')).toBe(true);

    const stack = await debug.command('native', 'stackTrace', { threadId: 1 });
    const body = stack.body as { stackFrames: { name: string; line: number }[] };
    expect(body.stackFrames[0]).toMatchObject({ name: 'xorshift32', line: 6 });

    const evaluated = await debug.command('native', 'evaluate', { expression: 'x' });
    expect(evaluated.body).toMatchObject({ result: '57351' });

    await debug.stop('native');
    expect(debug.isActive('native')).toBe(false);
  });

  it('reports an error for commands on dead sessions', async () => {
    const debug = ix.get(IDebugService);
    const result = await debug.command('ghost', 'continue', { threadId: 1 });
    expect(result.body).toMatchObject({ error: 'No debug session "ghost". Start one first.' });
  });

  it('rejects a second start on the same session name', async () => {
    const debug = ix.get(IDebugService);
    await debug.start('one', { kind: 'launch', program: '/work/demo.py' });
    const second = await debug.start('one', { kind: 'launch', program: '/work/demo.py' });
    expect(second.body).toMatchObject({ error: 'Session "one" already exists. Stop it first.' });
  });
});
