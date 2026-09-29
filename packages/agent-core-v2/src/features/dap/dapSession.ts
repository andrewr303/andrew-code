/**
 * `dap` domain — `DapSession`: one debug-adapter process.
 *
 * Not a DI service: created by `IDebugService`. Owns the stdio pump over
 * the adapter process: requests correlate by `request_seq`, events flow to
 * the registered listener (the `stopped` / `terminated` / `output` lifecycle
 * the caller drives), and `dispose` sends `disconnect` + `terminate` then
 * kills the process. One session, one debuggee.
 */

import type { IHostProcess } from '#/os/interface/hostProcess';

import {
  DapFrameDecoder,
  type DapEvent,
  type DapMessage,
  type DapResponse,
  encodeDapMessage,
} from './dapCodec';

export type DapEventListener = (event: DapEvent) => void;

export interface DapSessionOptions {
  readonly adapterId: string;
  readonly adapterIdentifier: string;
  readonly cwd: string;
  proc: IHostProcess;
}

interface Pending {
  readonly resolve: (body: unknown) => void;
  readonly reject: (error: Error) => void;
}

export class DapSession {
  private readonly decoder = new DapFrameDecoder();
  private readonly pending = new Map<number, Pending>();
  private nextSeq = 1;
  private disposed = false;
  private listener: DapEventListener | undefined;

  constructor(private readonly options: DapSessionOptions) {
    options.proc.stdout.setEncoding('utf8');
    options.proc.stdout.on('data', (chunk: string) => {
      for (const message of this.decoder.push(chunk)) this.route(message);
    });
    options.proc.stderr.setEncoding('utf8');
    options.proc.stderr.on('data', () => {
      // Drain only — adapter logs must never block the debuggee.
    });
    void options.proc.wait().catch(() => undefined);
  }

  onEvent(listener: DapEventListener): void {
    this.listener = listener;
  }

  private route(message: DapMessage): void {
    if (message.type === 'event') {
      this.listener?.(message);
      return;
    }
    if (message.type === 'response') {
      const response = message as DapResponse;
      const pending = this.pending.get(response.request_seq);
      if (pending === undefined) return;
      this.pending.delete(response.request_seq);
      if (response.success) pending.resolve(response.body);
      else pending.reject(new Error(`DAP ${response.command} failed: ${response.message ?? 'unknown error'}`));
      return;
    }
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      adapterID: this.options.adapterIdentifier,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
    });
  }

  request(command: string, arguments_?: unknown): Promise<unknown> {
    if (this.disposed) return Promise.reject(new Error(`DAP ${this.options.adapterId}: session disposed`));
    const seq = this.nextSeq++;
    const result = new Promise<unknown>((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
    });
    void this.write({ seq, type: 'request', command, arguments: arguments_ });
    return result;
  }

  private async write(message: DapMessage): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.options.proc.stdin.write(encodeDapMessage(message), (error) => {
        if (error !== undefined && error !== null) reject(error);
        else resolve();
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      pending.reject(new Error(`DAP ${this.options.adapterId}: session disposed`));
    }
    this.pending.clear();
    void this.write({ seq: this.nextSeq++, type: 'request', command: 'disconnect', arguments: { terminateDebuggee: true } }).catch(() => undefined);
    this.options.proc.dispose();
  }
}
