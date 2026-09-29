/**
 * `dap` domain — DAP message codec.
 *
 * The Debug Adapter Protocol shares LSP's `Content-Length` framing; this
 * module owns the DAP-specific shapes: `request` / `response` / `event`
 * messages with `seq` correlation, an incremental pure decoder, and the
 * adapter-registry defaults (debugpy / lldb-dap / gdb / dlv / rust-analyzer)
 * with launch-command resolution per adapter and file type. Pure data and
 * functions; no DI, no I/O. Adapter table ported from oh-my-pi's
 * `dap/defaults.json`.
 */

export interface DapRequest {
  readonly seq: number;
  readonly type: 'request';
  readonly command: string;
  readonly arguments?: unknown;
}

export interface DapResponse {
  readonly seq: number;
  readonly type: 'response';
  readonly request_seq: number;
  readonly success: boolean;
  readonly command: string;
  readonly message?: string;
  readonly body?: unknown;
}

export interface DapEvent {
  readonly seq: number;
  readonly type: 'event';
  readonly event: string;
  readonly body?: unknown;
}

export type DapMessage = DapRequest | DapResponse | DapEvent;

export function encodeDapMessage(message: DapMessage): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${String(Buffer.byteLength(body, 'utf8'))}\r\n\r\n${body}`;
}

export class DapFrameDecoder {
  private buffer = '';

  push(chunk: string): readonly DapMessage[] {
    this.buffer += chunk;
    const messages: DapMessage[] = [];
    let boundary = this.boundary();
    while (boundary !== undefined) {
      const body = this.buffer.slice(boundary.start, boundary.end);
      this.buffer = this.buffer.slice(boundary.end);
      try {
        const parsed = JSON.parse(body) as DapMessage;
        if (parsed !== null && typeof parsed === 'object' && parsed['type'] !== undefined) {
          messages.push(parsed);
        }
      } catch {
        // Malformed frame dropped; resync on the next header.
      }
      boundary = this.boundary();
    }
    return messages;
  }

  private boundary(): { start: number; end: number } | undefined {
    const headerEnd = this.buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return undefined;
    const header = this.buffer.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (match === null) {
      this.buffer = this.buffer.slice(headerEnd + 4);
      return this.boundary();
    }
    const start = headerEnd + 4;
    const end = start + Number.parseInt(match[1]!, 10);
    if (this.buffer.length < end) return undefined;
    return { start, end };
  }
}

export interface DapAdapterDefinition {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly fileTypes: readonly string[];
  readonly adapterID: string;
  readonly rootMarkers?: readonly string[];
}

export const DAP_ADAPTERS: readonly DapAdapterDefinition[] = [
  {
    id: 'debugpy',
    command: 'python3',
    args: ['-m', 'debugpy.adapter'],
    fileTypes: ['py'],
    adapterID: 'debugpy',
  },
  {
    id: 'lldb-dap',
    command: 'lldb-dap',
    args: [],
    fileTypes: ['c', 'cc', 'cpp', 'h', 'hpp', 'rs'],
    adapterID: 'lldb',
  },
  {
    id: 'gdb',
    command: 'gdb-dap' ,
    args: [],
    fileTypes: ['c', 'cc', 'cpp', 'h', 'hpp'],
    adapterID: 'gdb',
  },
  {
    id: 'dlv',
    command: 'dlv',
    args: ['dap'],
    fileTypes: ['go'],
    adapterID: 'dlv',
  },
];

export function adapterForFile(path: string): DapAdapterDefinition | undefined {
  const dot = path.lastIndexOf('.');
  const extension = dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
  return DAP_ADAPTERS.find((adapter) => adapter.fileTypes.includes(extension));
}
