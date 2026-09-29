/**
 * `kernel` domain — `IKernelService` implementation.
 *
 * Owns one persistent child process per named Python session (spawned from
 * the co-located `driver.py` through `hostProcess`) plus the stdio pump
 * that multiplexes cell results and bridge calls: lines carrying `bridge`
 * are answered inline from `hostFs` (read / recursive glob / recursive
 * regex grep, all confined to the session working directory) while the
 * awaiting cell holds its completion promise. JavaScript cells delegate to
 * the existing persistent Code Mode runtime (`codeMode.exec`) — the bridge
 * there is the `exec` tool itself. Stderr merges into the cell output.
 * `dispose` kills every child. Bound at Agent scope — contributed into
 * every Agent scope by `KernelFeature` (`features/kernel/kernelFeature`).
 */

import { Service } from '#/_base/di/service';
import { ICodeModeService } from '#/agent/codeMode/codeMode';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { IHostProcessService, type IHostProcess } from '#/os/interface/hostProcess';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import DRIVER from './driver.py?raw';
import { IKernelService, type KernelLanguage, type KernelResult } from './kernel';

interface PendingCell {
  readonly resolve: (result: KernelResult) => void;
  readonly reject: (reason: unknown) => void;
}

interface PythonSession {
  readonly proc: IHostProcess;
  readonly cells: Map<number, PendingCell>;
  buffer: string;
  nextId: number;
  dead: boolean;
}

const MAX_BRIDGE_WALK_ENTRIES = 20_000;
const MAX_GREP_MATCHES = 200;

export class AgentKernelService extends Service implements IKernelService {
  declare readonly _serviceBrand: undefined;

  private readonly sessions = new Map<string, PythonSession>();

  constructor(
    @IHostProcessService private readonly hostProcess: IHostProcessService,
    @IHostFileSystem private readonly hostFs: IHostFileSystem,
    @ISessionContext private readonly sessionCtx: ISessionContext,
    @ICodeModeService private readonly codeMode: ICodeModeService,
  ) {
    super();
  }

  override dispose(): void {
    for (const session of this.sessions.values()) {
      session.dead = true;
      for (const cell of session.cells.values()) {
        cell.reject(new Error('Kernel disposed.'));
      }
      session.cells.clear();
      session.proc.dispose();
    }
    this.sessions.clear();
    super.dispose();
  }

  async run(language: KernelLanguage, code: string, session?: string): Promise<KernelResult> {
    if (language === 'javascript') {
      const cell = await this.codeMode.exec(code, {});
      if (cell.status === 'failed') return { status: 'error', output: cell.error ?? 'exec failed' };
      return { status: 'ok', output: cell.output ?? '' };
    }
    const name = session ?? 'python';
    const handle = await this.sessionFor(name);
    return this.runCell(handle, code);
  }

  async reset(session?: string): Promise<void> {
    if (session === undefined) {
      for (const name of Array.from(this.sessions.keys())) await this.killSession(name);
      return;
    }
    await this.killSession(session);
  }

  private async killSession(name: string): Promise<void> {
    const handle = this.sessions.get(name);
    if (handle === undefined) return;
    this.sessions.delete(name);
    handle.dead = true;
    for (const cell of handle.cells.values()) cell.reject(new Error(`Kernel session "${name}" was reset.`));
    handle.cells.clear();
    try {
      await handle.proc.kill();
    } catch {
      // Already dead — dispose is enough.
    }
    handle.proc.dispose();
  }

  private async sessionFor(name: string): Promise<PythonSession> {
    const existing = this.sessions.get(name);
    if (existing !== undefined && !existing.dead) return existing;
    const proc = await this.hostProcess.spawn('python3', ['-u', '-c', DRIVER], {
      cwd: this.sessionCtx.cwd,
    });
    const handle: PythonSession = { proc, cells: new Map(), buffer: '', nextId: 1, dead: false };
    this.sessions.set(name, handle);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      void this.onData(handle, chunk).catch(() => undefined);
    });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', () => {
      // Drained so the child never blocks on a full pipe; cell output is
      // captured by the driver itself and arrives as result lines on stdout.
    });
    void proc.wait().then(() => {
      if (this.sessions.get(name) !== handle) return;
      this.sessions.delete(name);
      handle.dead = true;
      for (const cell of handle.cells.values()) {
        cell.reject(new Error('Python kernel exited unexpectedly.'));
      }
      handle.cells.clear();
    }).catch(() => undefined);
    return handle;
  }

  private runCell(handle: PythonSession, code: string): Promise<KernelResult> {
    const id = handle.nextId++;
    const completion = new Promise<KernelResult>((resolve, reject) => {
      handle.cells.set(id, { resolve, reject });
    });
    handle.proc.stdin.write(`${JSON.stringify({ id, code })}\n`, (error) => {
      if (error !== undefined && error !== null) {
        handle.cells.delete(id);
        const pending = handle.cells.get(id);
        pending?.reject(error);
      }
    });
    return completion;
  }

  private async onData(handle: PythonSession, chunk: string): Promise<void> {
    handle.buffer += chunk;
    for (const bridge of this.takeBridges(handle)) {
      let result: unknown;
      try {
        result = await this.answerBridge(bridge.tool, bridge.args);
      } catch (error) {
        result = { __error__: error instanceof Error ? error.message : String(error) };
      }
      if (handle.dead) return;
      handle.proc.stdin.write(`${JSON.stringify({ bridge: bridge.id, result })}\n`);
    }
  }

  private takeBridges(handle: PythonSession): { id: number; tool: string; args: Record<string, unknown> }[] {
    const out: { id: number; tool: string; args: Record<string, unknown> }[] = [];
    let newline = handle.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = handle.buffer.slice(0, newline).trim();
      handle.buffer = handle.buffer.slice(newline + 1);
      if (line.length > 0) this.routeLine(handle, line, out);
      newline = handle.buffer.indexOf('\n');
    }
    return out;
  }

  private routeLine(
    handle: PythonSession,
    line: string,
    bridges: { id: number; tool: string; args: Record<string, unknown> }[],
  ): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof msg['bridge'] === 'number') {
      bridges.push({
        id: msg['bridge'] as number,
        tool: asString(msg['tool']),
        args: (msg['args'] as Record<string, unknown>) ?? {},
      });
      return;
    }
    if (typeof msg['id'] === 'number') {
      const cell = handle.cells.get(msg['id'] as number);
      if (cell === undefined) return;
      handle.cells.delete(msg['id'] as number);
      cell.resolve({
        status: msg['status'] === 'error' ? 'error' : 'ok',
        output: asString(msg['output']),
      });
    }
  }

  private async answerBridge(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const root = this.sessionCtx.cwd;
    switch (tool) {
      case 'read': {
        return this.hostFs.readText(confine(root, asString(args['path'])));
      }
      case 'glob': {
        return this.glob(root, asString(args['pattern']));
      }
      case 'grep': {
        return this.grep(root, asString(args['pattern']), asString(args['path'], '.'));
      }
      default:
        throw new Error(`Unknown bridge tool "${tool}".`);
    }
  }

  private async glob(root: string, pattern: string): Promise<string[]> {
    const files = await this.walk(root, root, []);
    const regex = globToRegExp(pattern);
    return files.filter((file) => regex.test(file));
  }

  private async grep(root: string, pattern: string, sub: string): Promise<string[]> {
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      throw new Error(`Invalid regex "${pattern}".`);
    }
    const base = confine(root, sub);
    const files = await this.walk(root, base, []);
    const matches: string[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = await this.hostFs.readText(`${root}/${file}`);
      } catch {
        continue;
      }
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index++) {
        regex.lastIndex = 0;
        if (regex.test(lines[index]!)) {
          matches.push(`${file}:${String(index + 1)}:${lines[index]!.slice(0, 200)}`);
          if (matches.length >= MAX_GREP_MATCHES) return matches;
        }
      }
    }
    return matches;
  }

  private async walk(root: string, dir: string, out: string[]): Promise<string[]> {
    let entries: readonly { readonly name: string; readonly isFile: boolean; readonly isDirectory: boolean }[];
    try {
      entries = await this.hostFs.readdir(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (out.length >= MAX_BRIDGE_WALK_ENTRIES) return out;
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = `${dir}/${entry.name}`;
      if (entry.isFile) {
        out.push(full.startsWith(`${root}/`) ? full.slice(root.length + 1) : full);
      } else if (entry.isDirectory) {
        await this.walk(root, full, out);
      }
    }
    return out;
  }
}

function confine(root: string, candidate: string): string {
  const normalized = candidate.replaceAll('\\', '/');
  const stacked = `${root}/${normalized}`.split('/');
  const resolved: string[] = [];
  for (const part of stacked) {
    if (part === '' || part === '.') continue;
    if (part === '..') resolved.pop();
    else resolved.push(part);
  }
  const confined = `/${resolved.join('/')}`;
  const rootSlash = root.endsWith('/') ? root : `${root}/`;
  if (confined !== root && !confined.startsWith(rootSlash)) {
    throw new Error(`Path "${candidate}" escapes the workspace.`);
  }
  return confined;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll('\\', '/').trim();
  let source = '';
  let index = 0;
  while (index < normalized.length) {
    if (normalized.startsWith('**/', index)) {
      source += '(?:.*/)?';
      index += 3;
    } else if (normalized.startsWith('**', index)) {
      source += '.*';
      index += 2;
    } else {
      const char = normalized[index]!;
      if (char === '*') source += '[^/]*';
      else if (char === '?') source += '[^/]';
      else source += escapeRegExp(char);
      index += 1;
    }
  }
  return new RegExp(`^(?:.*/)?${source}$`);
}

function escapeRegExp(char: string): string {
  return char.replace(/[$()*+.?[\\\]^{|}]/, '\\$&');
}

/** Coerce an unknown JSON field to text without [object Object] fallbacks. */
function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export { AgentKernelService as Kernel };
