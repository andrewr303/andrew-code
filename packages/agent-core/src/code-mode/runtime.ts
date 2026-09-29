import { createContext, runInContext, type Context } from 'node:vm';
import { randomUUID } from 'node:crypto';

export interface CodeModeToolResult {
  readonly name: string;
  readonly result: unknown;
  readonly isError?: boolean;
}

export type CodeModeToolDispatcher = (
  name: string,
  args: unknown,
  signal?: AbortSignal,
) => Promise<CodeModeToolResult>;

export interface CodeModeCell {
  readonly id: string;
  readonly status: 'running' | 'yielded' | 'completed' | 'failed';
  readonly output?: string;
  readonly error?: string;
}

const EXEC_DEFAULT_MS = 30_000;
const WAIT_DEFAULT_MS = 10_000;

export class CodeModeRuntime {
  private context: Context | undefined;
  private readonly cells = new Map<string, CodeModeCell>();
  private dispatcher: CodeModeToolDispatcher | undefined;

  attach(dispatcher: CodeModeToolDispatcher): void {
    this.dispatcher = dispatcher;
    this.context = undefined;
  }

  dispose(): void {
    this.context = undefined;
    this.cells.clear();
    this.dispatcher = undefined;
  }

  listCells(): readonly CodeModeCell[] {
    return [...this.cells.values()];
  }

  async exec(source: string, options?: { readonly timeoutMs?: number; readonly signal?: AbortSignal }): Promise<CodeModeCell> {
    const id = randomUUID();
    const timeoutMs = options?.timeoutMs ?? EXEC_DEFAULT_MS;
    this.cells.set(id, { id, status: 'running' });
    try {
      const output = await this.runSource(source, timeoutMs, options?.signal);
      const cell: CodeModeCell = { id, status: 'completed', output };
      this.cells.set(id, cell);
      return cell;
    } catch (error) {
      const cell: CodeModeCell = {
        id,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
      this.cells.set(id, cell);
      return cell;
    }
  }

  async wait(cellId: string, options?: { readonly timeoutMs?: number }): Promise<CodeModeCell> {
    const started = Date.now();
    const timeoutMs = options?.timeoutMs ?? WAIT_DEFAULT_MS;
    while (Date.now() - started < timeoutMs) {
      const cell = this.cells.get(cellId);
      if (cell === undefined) {
        return { id: cellId, status: 'failed', error: `unknown cell ${cellId}` };
      }
      if (cell.status === 'completed' || cell.status === 'failed') return cell;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.cells.get(cellId) ?? { id: cellId, status: 'failed', error: 'wait timed out' };
  }

  private sandbox(): Context {
    if (this.context !== undefined) return this.context;
    const dispatcher = this.dispatcher;
    const tools = new Proxy(
      {},
      {
        get: (_target, rawName) => {
          const name = String(rawName);
          return async (args: unknown) => {
            if (dispatcher === undefined) {
              throw new Error(`tools.${name} is unavailable: no dispatcher attached`);
            }
            const result = await dispatcher(name, args ?? {});
            if (result.isError === true) {
              throw new Error(typeof result.result === 'string' ? result.result : `tools.${name} failed`);
            }
            return result.result;
          };
        },
      },
    );
    this.context = createContext(
      {
        tools,
        console: { log() {}, warn() {}, error() {}, info() {} },
        setTimeout,
        clearTimeout,
        Promise,
        JSON,
        Math,
        Date,
        Array,
        Object,
        Map,
        Set,
        Error,
      },
      { name: 'andrewcode-code-mode' },
    );
    return this.context;
  }

  private async runSource(source: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    const wrapped = `"use strict"; (async () => {\n${source}\n})()`;
    const result: unknown = runInContext(wrapped, this.sandbox(), {
      timeout: timeoutMs,
      displayErrors: true,
      breakOnSigint: true,
    });
    if (signal?.aborted === true) throw new Error('exec cancelled');
    if (isThenable(result)) {
      const value = await Promise.race([
        result,
        timeoutReject(timeoutMs + 1_000),
      ]);
      return stringifyOutput(value);
    }
    return stringifyOutput(result);
  }
}

function isThenable(value: unknown): value is Promise<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

function timeoutReject(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`exec exceeded ${String(ms)}ms`)), ms);
  });
}

function stringifyOutput(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
