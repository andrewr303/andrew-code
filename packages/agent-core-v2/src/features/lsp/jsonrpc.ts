/**
 * `lsp` domain — minimal JSON-RPC 2.0 framing over stdio.
 *
 * Encodes messages as `Content-Length: N\r\n\r\n{json}` frames and parses
 * inbound bytes back into messages through an incremental, pure
 * `LspFrameDecoder` — feed it chunks, get complete JSON messages back.
 * Pure protocol code; no DI, no I/O.
 */

export interface JsonRpcMessage {
  readonly jsonrpc: '2.0';
  readonly id?: number | string | null;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown };
}

export function encodeFrame(message: JsonRpcMessage): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${String(Buffer.byteLength(body, 'utf8'))}\r\n\r\n${body}`;
}

export class LspFrameDecoder {
  private buffer = '';

  push(chunk: string): readonly JsonRpcMessage[] {
    this.buffer += chunk;
    const messages: JsonRpcMessage[] = [];
    let separator = this.frameBoundary();
    while (separator !== undefined) {
      const body = this.buffer.slice(separator.bodyStart, separator.bodyEnd);
      this.buffer = this.buffer.slice(separator.bodyEnd);
      try {
        const parsed = JSON.parse(body) as JsonRpcMessage;
        if (parsed !== null && typeof parsed === 'object' && parsed['jsonrpc'] === '2.0') {
          messages.push(parsed);
        }
      } catch {
        // A malformed frame is dropped; the stream resyncs on the next header.
      }
      separator = this.frameBoundary();
    }
    return messages;
  }

  private frameBoundary(): { bodyStart: number; bodyEnd: number } | undefined {
    const headerEnd = this.buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return undefined;
    const header = this.buffer.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (match === null) {
      // Not an LSP frame; drop through and resync after the header.
      this.buffer = this.buffer.slice(headerEnd + 4);
      return this.frameBoundary();
    }
    const length = Number.parseInt(match[1]!, 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (this.buffer.length < bodyEnd) return undefined;
    return { bodyStart, bodyEnd };
  }
}
