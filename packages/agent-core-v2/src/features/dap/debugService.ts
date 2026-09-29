/**
 * `dap` domain — `IDebugService` implementation.
 *
 * Spawns the adapter resolved for the program's file type (or the session's
 * declared kind) through `hostProcess` rooted at the session working
 * directory, drives the `initialize` handshake, and forwards the tool's
 * commands to the live `DapSession`. `launch` / `attach` map to their DAP
 * requests with the debuggee wired through `cwd`; `continue`/`next`/
 * `stepIn`/`stepOut`/`pause` pass straight through; `stackTrace` /
 * `scopes` / `variables` / `evaluate` / `setBreakpoints` carry their
 * arguments. A `stopped` event on a session re-resolves nothing — the
 * agent polls `stackTrace` after each step, matching the donor's debug
 * loop. `dispose` kills every adapter. Bound at Agent scope — contributed
 * by `DebugFeature` (`features/dap/debugFeature`).
 */

import { Service } from '#/_base/di/service';
import { IHostProcessService } from '#/os/interface/hostProcess';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { type DapAdapterDefinition, adapterForFile } from './dapCodec';
import { DapSession } from './dapSession';
import {
  type DebugLaunchInput,
  type DebugServiceResult,
  IDebugService,
} from './debug';

export class AgentDebugService extends Service implements IDebugService {
  declare readonly _serviceBrand: undefined;

  private readonly live = new Map<string, { session: DapSession; adapter: DapAdapterDefinition }>();

  constructor(
    @IHostProcessService private readonly hostProcess: IHostProcessService,
    @ISessionContext private readonly sessionCtx: ISessionContext,
  ) {
    super();
  }

  override dispose(): void {
    for (const entry of this.live.values()) entry.session.dispose();
    this.live.clear();
    super.dispose();
  }

  async start(session: string, input: DebugLaunchInput): Promise<DebugServiceResult> {
    if (this.live.has(session)) {
      return { body: { error: `Session "${session}" already exists. Stop it first.` } };
    }
    const adapter =
      adapterForFile(input.program ?? '') ??
      (input.kind === 'attach'
        ? { id: 'attach-default', command: 'lldb-dap', args: [], fileTypes: [], adapterID: 'lldb' }
        : undefined);
    if (adapter === undefined) {
      return { body: { error: 'No debug adapter known for this program type.' } };
    }
    const proc = await this.hostProcess.spawn(adapter.command, [...adapter.args], {
      cwd: this.sessionCtx.cwd,
    });
    const dap = new DapSession({
      adapterId: session,
      adapterIdentifier: adapter.adapterID,
      cwd: this.sessionCtx.cwd,
      proc,
    });
    try {
      await dap.initialize();
      const launchArgs: Record<string, unknown> = {
        cwd: this.sessionCtx.cwd,
        ...(input.program !== undefined ? { program: input.program } : {}),
        ...(input.args !== undefined ? { args: [...input.args] } : {}),
        ...(input.pid !== undefined ? { pid: input.pid } : {}),
        ...(input.stopOnEntry !== undefined ? { stopOnEntry: input.stopOnEntry } : {}),
      };
      const body = await dap.request(input.kind, launchArgs);
      this.live.set(session, { session: dap, adapter });
      return { body };
    } catch (error) {
      dap.dispose();
      return { body: { error: error instanceof Error ? error.message : String(error) } };
    }
  }

  async stop(session: string): Promise<void> {
    const entry = this.live.get(session);
    if (entry === undefined) return;
    this.live.delete(session);
    entry.session.dispose();
  }

  async command(session: string, command: string, args?: unknown): Promise<DebugServiceResult> {
    const entry = this.live.get(session);
    if (entry === undefined) {
      return { body: { error: `No debug session "${session}". Start one first.` } };
    }
    try {
      const body = await entry.session.request(command, args ?? {});
      return { body };
    } catch (error) {
      return { body: { error: error instanceof Error ? error.message : String(error) } };
    }
  }

  isActive(session: string): boolean {
    return this.live.has(session);
  }

  sessions(): readonly string[] {
    return [...this.live.keys()];
  }
}
