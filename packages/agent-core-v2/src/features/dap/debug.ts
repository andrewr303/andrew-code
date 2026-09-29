/**
 * `dap` domain — `IDebugService` contract.
 *
 * Real-debugger support (oh-my-pi's `dap` domain): launch or attach a
 * debuggee through a DAP adapter (debugpy, lldb-dap, gdb, dlv), then drive
 * it — breakpoints, continue, stepping, pause, stack/scopes/variables
 * inspection, expression evaluation — all against the live adapter.
 * Sessions are named and persist across tool calls for the agent's
 * lifetime; disposal kills every adapter process. Bound at Agent scope —
 * contributed into every Agent scope by `DebugFeature`
 * (`features/dap/debugFeature`).
 */

import { createDecorator } from '#/_base/di/instantiation';

export interface DebugLaunchInput {
  readonly kind: 'launch' | 'attach';
  readonly program?: string;
  readonly args?: readonly string[];
  readonly pid?: number;
  readonly stopOnEntry?: boolean;
}

export interface StackFrameInfo {
  readonly id: number;
  readonly name: string;
  readonly file?: string;
  readonly line?: number;
}

export interface DebugServiceResult {
  readonly body: unknown;
}

export interface IDebugService {
  readonly _serviceBrand: undefined;

  /** Start a named debug session (launch a program or attach to a pid). */
  start(session: string, input: DebugLaunchInput): Promise<DebugServiceResult>;

  /** Stop and remove a session. */
  stop(session: string): Promise<void>;

  /** Issue a DAP command on a live session (continue, next, evaluate, ...). */
  command(session: string, command: string, args?: unknown): Promise<DebugServiceResult>;

  /** Whether a session is live. */
  isActive(session: string): boolean;

  /** Sessions currently live. */
  sessions(): readonly string[];
}

export const IDebugService = createDecorator<IDebugService>('debugService');
