/**
 * Scenario: frame codec round-trip, client handshake, rename with import rewrites.
 * Responsibilities: verify JSON-RPC framing, request correlation, willRenameFiles apply, fallback move.
 * Wiring: real jsonrpc + lspClient + FileRenameService; fake server process over PassThrough.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/features/lsp.test.ts`.
 */
import { PassThrough } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { IFlagService } from '#/app/flag/flag';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { IHostProcessService, type IHostProcess } from '#/os/interface/hostProcess';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { encodeFrame, LspFrameDecoder } from '#/features/lsp/jsonrpc';
import { IFileRenameService } from '#/features/lsp/lsp';
import { FileRenameService } from '#/features/lsp/lspService';
import { resolveServerCommand } from '#/features/lsp/serverResolver';

import { stubFlag } from '../app/flag/stubs';

class FakeServerProcess implements IHostProcess {
  readonly _serviceBrand: undefined = undefined;
  readonly pid = 9001;
  exitCode: number | null = null;
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  disposed = false;

  private pending: string[] = [];

  constructor() {
    this.stdin.on('data', (chunk: Buffer) => {
      this.pending.push(String(chunk));
      const joined = this.pending.join('');
      this.pending = [joined];
      let boundary = this.findFrame(joined);
      while (boundary !== undefined) {
        const body = joined.slice(boundary.start, boundary.end);
        this.handle(JSON.parse(body) as Record<string, unknown>);
        this.pending = [joined.slice(boundary.end)];
        boundary = this.findFrame(this.pending[0]!);
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

  private handle(message: Record<string, unknown>): void {
    const method = typeof message['method'] === 'string' ? message['method'] : '';
    const id = message['id'];
    switch (method) {
      case 'initialize':
        this.respond(id, { capabilities: {} });
        return;
      case 'workspace/willRenameFiles':
        this.respond(id, {
          changes: {
            'file:///work/imports.ts': [
              {
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 11 } },
                newText: "from './b'",
              },
            ],
          },
        });
        return;
      default:
        if (id !== undefined) this.respond(id, null);
    }
  }

  private respond(id: unknown, result: unknown): void {
    this.stdout.write(encodeFrame({ jsonrpc: '2.0', id: id as number, result }));
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

describe('lsp — JSON-RPC framing and rename (src/features/lsp)', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let files: Map<string, string>;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    files = new Map<string, string>([
      ['/work/a.ts', "from './a'\nrest\n"],
      ['/work/imports.ts', "from './a'\nrest\n"],
    ]);
    ix.stub(IHostProcessService, {
      _serviceBrand: undefined,
      spawn: async () => new FakeServerProcess(),
    } as unknown as IHostProcessService);
    ix.stub(IHostFileSystem, {
      _serviceBrand: undefined,
      stat: async (path: string) => {
        if (files.has(path) || path.endsWith('node_modules/.bin/typescript-language-server')) {
          return { isFile: true, isDirectory: false, size: 0 };
        }
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
      readText: async (path: string) => {
        const body = files.get(path);
        if (body === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return body;
      },
      writeText: async (path: string, data: string) => {
        files.set(path, data);
      },
      readBytes: async (path: string) => {
        const body = files.get(path);
        if (body === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return new TextEncoder().encode(body);
      },
      writeBytes: async (path: string, bytes: Uint8Array) => {
        files.set(path, new TextDecoder().decode(bytes));
      },
      mkdir: async () => undefined,
      remove: async (path: string) => {
        files.delete(path);
      },
    } as unknown as IHostFileSystem);
    ix.stub(ISessionContext, { cwd: '/work' } as ISessionContext);
    ix.stub(IFlagService, stubFlag(true));
    ix.set(IFileRenameService, new SyncDescriptor(FileRenameService));
  });
  afterEach(() => disposables.dispose());

  it('frame decoder round-trips split chunks', () => {
    const decoder = new LspFrameDecoder();
    const frame = encodeFrame({ jsonrpc: '2.0', id: 1, method: 'x', params: { a: 1 } });
    const split = [frame.slice(0, 10), frame.slice(10, 25), frame.slice(25)];
    const messages = split.flatMap((chunk) => decoder.push(chunk));
    expect(messages).toEqual([{ jsonrpc: '2.0', id: 1, method: 'x', params: { a: 1 } }]);
  });

  it('resolveServerCommand prefers the workspace-local binary', async () => {
    const fs = ix.get(IHostFileSystem);
    const command = await resolveServerCommand('/work/a.ts', fs, ['/work']);
    expect(command?.command).toBe('/work/node_modules/.bin/typescript-language-server');
    expect(command?.args).toEqual(['--stdio']);
  });

  it('renameFile applies willRenameFiles edits then moves the file', async () => {
    const renames = ix.get(IFileRenameService);
    const outcome = await renames.renameFile('/work/a.ts', '/work/b.ts');
    expect(outcome.moved).toBe(true);
    expect(outcome.serverUsed).toBe(true);
    expect(outcome.editedFiles).toEqual(['/work/imports.ts']);
    expect(files.get('/work/imports.ts')).toBe("from './b'\nrest\n");
    expect(files.has('/work/a.ts')).toBe(false);
    expect(files.get('/work/b.ts')).toBe("from './a'\nrest\n");
  });

  it('falls back to a plain move when the flag is off', async () => {
    ix.stub(IFlagService, stubFlag(false));
    const renames = ix.get(IFileRenameService);
    const outcome = await renames.renameFile('/work/a.ts', '/work/b.ts');
    expect(outcome.moved).toBe(true);
    expect(outcome.serverUsed).toBe(false);
    expect(files.get('/work/imports.ts')).toBe("from './a'\nrest\n");
  });
});
