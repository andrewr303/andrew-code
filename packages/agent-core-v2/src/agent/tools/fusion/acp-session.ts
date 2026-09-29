/**
 * Minimal ACP client for Fusion panelists. Keep in lockstep with
 * packages/agent-core/src/external-cli/acp-session.ts.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export type FusionAcpProvider =
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'opencode'
  | 'grok'
  | 'kimi'
  | 'andrewcode';

export interface AcpSessionResult {
  readonly usedAcp: boolean;
  readonly output: string;
  readonly error?: string;
  readonly exitCode?: number;
}

type AcpCommand = readonly [bin: string, args: readonly string[]];

const ACP_COMMANDS: Record<FusionAcpProvider, readonly AcpCommand[]> = {
  claude: [
    ['claude', ['--acp']],
    ['claude', ['acp']],
  ],
  grok: [
    ['grok', ['agent', 'stdio']],
    ['open-grok', ['agent', 'stdio']],
  ],
  opencode: [['opencode', ['acp']]],
  kimi: [['kimi', ['acp']]],
  andrewcode: [['andrewcode', ['acp']]],
  copilot: [
    ['copilot', ['--acp']],
    ['copilot', ['acp']],
  ],
  codex: [
    ['codex', ['acp']],
    ['codex', ['--acp']],
  ],
};

export async function runAcpSession(request: {
  readonly provider: FusionAcpProvider;
  readonly prompt: string;
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}): Promise<AcpSessionResult> {
  const timeoutMs = request.timeoutMs ?? 900_000;
  const cwd = request.cwd ?? process.cwd();
  let lastError = 'ACP not available';
  for (const command of ACP_COMMANDS[request.provider]) {
    const [bin, args] = command;
    try {
      return await runOneAcpProcess({
        bin,
        args,
        prompt: request.prompt,
        cwd,
        timeoutMs,
        signal: request.signal,
      });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return { usedAcp: false, output: '', error: lastError };
}

async function runOneAcpProcess(options: {
  readonly bin: string;
  readonly args: readonly string[];
  readonly prompt: string;
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}): Promise<AcpSessionResult> {
  const child = spawn(options.bin, [...options.args], {
    cwd: options.cwd,
    env: process.env,
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (child.stdin === null || child.stdout === null) {
    child.kill();
    throw new Error(`failed to open ACP stdio for ${options.bin}`);
  }

  let nextId = 1;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const chunks: string[] = [];
  let stderr = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const message = parsed as Record<string, unknown>;
    if (typeof message['id'] === 'number' && pending.has(message['id'])) {
      const waiter = pending.get(message['id']);
      pending.delete(message['id']);
      if (message['error'] !== undefined) {
        waiter?.reject(new Error(formatRpcError(message['error'])));
      } else {
        waiter?.resolve(message['result']);
      }
      return;
    }
    if (typeof message['method'] === 'string') {
      handleNotification(message, chunks, (id, result) => writeJson(child.stdin, { jsonrpc: '2.0', id, result }));
    }
  });

  const write = (payload: Record<string, unknown>): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      writeJson(child.stdin, { jsonrpc: '2.0', id, ...payload });
    });
  };

  const timer = setTimeout(() => {
    child.kill('SIGTERM');
  }, options.timeoutMs);
  const onAbort = (): void => {
    child.kill('SIGTERM');
  };
  options.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    await write({
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientInfo: { name: 'andrewcode', version: '0.0.0' },
        capabilities: { fs: {}, terminal: {} },
      },
    });
    const session = await write({
      method: 'session/new',
      params: { cwd: options.cwd, mcpServers: [] },
    });
    const sessionId = readSessionId(session);
    if (sessionId === undefined) {
      throw new Error('ACP session/new did not return a sessionId');
    }
    await write({
      method: 'session/prompt',
      params: {
        sessionId,
        prompt: [{ type: 'text', text: options.prompt }],
      },
    });
    const output = chunks.join('').trim();
    if (output.length === 0 && stderr.trim().length > 0) {
      throw new Error(stderr.trim());
    }
    return { usedAcp: true, output, exitCode: 0 };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    rl.close();
    if (!child.killed) child.kill('SIGTERM');
  }
}

function handleNotification(
  message: Record<string, unknown>,
  chunks: string[],
  respond: (id: number, result: unknown) => void,
): void {
  const method = String(message['method']);
  const params = isRecord(message['params']) ? message['params'] : {};
  if (method === 'session/update' || method === 'session/update_session') {
    collectUpdate(params, chunks);
    return;
  }
  if (typeof message['id'] === 'number' && method.includes('request_permission')) {
    respond(message['id'], { outcome: { outcome: 'selected', optionId: 'allow-once' } });
  }
}

function collectUpdate(params: Record<string, unknown>, chunks: string[]): void {
  const update = isRecord(params['update']) ? params['update'] : params;
  const sessionUpdate = typeof update['sessionUpdate'] === 'string' ? update['sessionUpdate'] : '';
  if (sessionUpdate === 'agent_message_chunk' || sessionUpdate === 'agent_message') {
    const content = update['content'];
    if (isRecord(content) && typeof content['text'] === 'string') {
      chunks.push(content['text']);
    } else if (typeof content === 'string') {
      chunks.push(content);
    }
  }
  if (typeof update['text'] === 'string') chunks.push(update['text']);
}

function readSessionId(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  if (typeof result['sessionId'] === 'string') return result['sessionId'];
  if (isRecord(result['session']) && typeof result['session']['sessionId'] === 'string') {
    return result['session']['sessionId'];
  }
  return undefined;
}

function writeJson(stdin: NodeJS.WritableStream | null, payload: unknown): void {
  if (stdin === null) return;
  stdin.write(`${JSON.stringify(payload)}\n`);
}

function formatRpcError(error: unknown): string {
  if (isRecord(error) && typeof error['message'] === 'string') return error['message'];
  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
