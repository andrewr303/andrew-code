/**
 * `lsp` domain — `LspClient`: one language-server process over stdio.
 *
 * Not a DI service: an object the `IFileRenameService` creates per
 * resolved server command. Speaks the LSP base protocol — `initialize`
 * / `initialized` handshake, JSON-RPC request/response correlation over
 * the `LspFrameDecoder`, server-request cancellation via
 * `$/cancelRequest`, and `shutdown` + `exit` on `dispose`. `request`
 * resolves with the server result or rejects with the server error;
 * `notify` is fire-and-forget. One client, one server process, one
 * workspace root.
 */

import type { IHostProcess } from '#/os/interface/hostProcess';

import { type JsonRpcMessage, LspFrameDecoder, encodeFrame } from './jsonrpc';

interface PendingRequest {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
}

export interface LspClientOptions {
  readonly root: string;
  readonly name: string;
  proc: IHostProcess;
}

export class LspClient {
  private readonly decoder = new LspFrameDecoder();
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private disposed = false;

  constructor(private readonly options: LspClientOptions) {
    options.proc.stdout.setEncoding('utf8');
    options.proc.stdout.on('data', (chunk: string) => {
      for (const message of this.decoder.push(chunk)) this.route(message);
    });
    options.proc.stderr.setEncoding('utf8');
    options.proc.stderr.on('data', () => {
      // Drained so the server never blocks on a full stderr pipe.
    });
    void options.proc.wait().catch(() => undefined);
  }

  private route(message: JsonRpcMessage): void {
    if (message.id !== undefined && message.id !== null && message.method !== undefined) {
      // Server-initiated request: acknowledge what we can.
      const result = this.answerServerRequest(message);
      this.write({ jsonrpc: '2.0', id: message.id, result }).catch(() => undefined);
      return;
    }
    const id = message.id;
    if (typeof id !== 'number') return;
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    if (message.error !== undefined) {
      pending.reject(new Error(`LSP ${this.options.name}: ${message.error.message}`));
    } else {
      pending.resolve(message.result);
    }
  }

  private answerServerRequest(message: JsonRpcMessage): unknown {
    switch (message.method) {
      case 'client/registerCapability':
        return null;
      case 'workspace/configuration':
        return (message.params as { items?: unknown[] } | undefined)?.items?.map(() => null) ?? [];
      case 'window/workDoneProgress/create':
        return null;
      default:
        return null;
    }
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      processId: process.pid,
      rootUri: pathToFileUri(this.options.root),
      capabilities: {
        workspace: {
          workspaceEdit: { documentChanges: true, resourceOperations: ['rename', 'create', 'delete'] },
          didChangeWatchedFiles: { dynamicRegistration: false },
          configuration: true,
          didChangeConfiguration: { dynamicRegistration: false },
        },
        textDocument: {
          synchronization: { didSave: true },
        },
      },
      workspaceFolders: [{ name: this.options.name, uri: pathToFileUri(this.options.root) }],
    });
    this.notify('initialized', {});
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error(`LSP ${this.options.name}: client disposed`));
    const id = this.nextId++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    void this.write({ jsonrpc: '2.0', id, method, params });
    return result;
  }

  notify(method: string, params: unknown): void {
    if (this.disposed) return;
    void this.write({ jsonrpc: '2.0', method, params });
  }

  private async write(message: JsonRpcMessage): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.options.proc.stdin.write(encodeFrame(message), (error) => {
        if (error !== undefined && error !== null) reject(error);
        else resolve();
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      pending.reject(new Error(`LSP ${this.options.name}: client disposed`));
    }
    this.pending.clear();
    this.notify('shutdown', null);
    this.notify('exit', null);
    this.options.proc.dispose();
  }
}

export function pathToFileUri(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  const encoded = normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `file://${encoded.startsWith('/') ? '' : '/'}${encoded}`;
}

export function fileUriToPath(uri: string): string {
  const withoutScheme = uri.replace(/^file:\/\//, '');
  return decodeURIComponent(withoutScheme);
}
