/**
 * External coding-CLI panelists used by Fusion and OAuth login bridges.
 *
 * These are process-level integrations (codex / claude / …), not kosong
 * chat providers. Auth is owned by each CLI's own OAuth flow.
 */

export type ExternalCliId =
  | 'claude'
  | 'codex'
  | 'copilot'
  | 'opencode'
  | 'grok'
  | 'kimi'
  | 'andrewcode';

export type ExternalCliAvailability =
  | 'available'
  | 'missing'
  | 'degraded'
  | 'host-native';

export interface ExternalCliProbe {
  readonly id: ExternalCliId;
  readonly binary: string;
  readonly status: ExternalCliAvailability;
  readonly path?: string;
}

export interface ExternalCliDetectResult {
  readonly host: ExternalCliId | 'none';
  readonly providers: Readonly<Record<ExternalCliId, ExternalCliProbe>>;
  readonly livePanelists: number;
  readonly multiModel: boolean;
  readonly metaloop?: Readonly<Record<string, string>>;
}

export interface ExternalCliDispatchRequest {
  readonly provider: ExternalCliId;
  readonly prompt: string;
  /** Working directory the panelist should treat as the project root. */
  readonly cwd?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface ExternalCliDispatchResult {
  readonly provider: ExternalCliId;
  readonly status: 'returned' | 'absent' | 'timeout' | 'error';
  readonly output: string;
  readonly ms: number;
  readonly error?: string;
  readonly exitCode?: number;
}

export type FusionMode =
  | 'solo'
  | 'panel'
  | 'council'
  | 'debate'
  | 'vote'
  | 'swarm'
  | 'detect'
  | 'graph'
  | 'hive'
  | 'designer'
  | 'metaloop'
  | 'ultracode'
  | 'ultraswarm'
  | 'board'
  | 'context';

export type FusionBoardVerb = 'init' | 'agents' | 'poll' | 'channels' | 'tree' | 'mentions';

export type FusionContextAction = 'list' | 'get' | 'set' | 'clear' | 'snapshot';

/** Script-backed Fusion forms (routed through fusion/swarm plugin bash). */
export type ScriptForm =
  | 'graph'
  | 'hive'
  | 'designer'
  | 'metaloop'
  | 'ultracode'
  | 'ultraswarm'
  | 'board'
  | 'context';

export interface FusionPanelRequest {
  readonly prompt: string;
  readonly mode?: FusionMode;
  /** Explicit panelist list; when omitted, all available external panelists run. */
  readonly providers?: readonly ExternalCliId[];
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface FusionPanelResult {
  readonly mode: FusionMode;
  readonly host: ExternalCliId | 'none';
  readonly panel: readonly ExternalCliDispatchResult[];
  readonly returned: number;
  readonly absent: number;
  readonly ms: number;
}
