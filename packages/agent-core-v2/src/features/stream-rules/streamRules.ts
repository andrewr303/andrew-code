/**
 * `stream-rules` domain — `IStreamRulesService` contract.
 *
 * Time-traveling stream rules (TTSR): dormant user-authored rules that fire
 * only when the model's streamed output goes off-script. A rule pairs a name
 * with a regex trigger and the corrective body to inject; on a match the
 * service appends the body as a `<system-reminder>` through `systemReminder`
 * (so the correction survives compaction like any other reminder), records
 * the rule name in the `streamRule` wire vocabulary (so replays and
 * post-compaction summaries keep the fact that guidance was given), and asks
 * the loop to keep the turn alive with a `ContinuationStepRequest` so the
 * model course-corrects in the same turn instead of paying a full extra turn.
 *
 * Rules load from `rules/*.md` under the session workspace directory:
 * each file's name (minus `.md`) is the rule name and its body is the
 * injected guidance — the same shape oh-my-pi's `TtsrManager` consumes.
 * Matching runs over streamed text deltas (`assistant.delta` /
 * `thinking.delta` bus events accumulated per step) and over finalized tool
 * arguments at `onDidFinishStep` time (tools whose args never stream, e.g.
 * synthesized exec calls, are still caught). Bound at Agent scope —
 * contributed into every Agent scope by `StreamRulesFeature`
 * (`features/stream-rules/streamRulesFeature`).
 */

import { createDecorator } from '#/_base/di/instantiation';

export interface StreamRule {
  readonly name: string;
  readonly pattern: RegExp;
  readonly body: string;
}

export interface StreamRuleMatch {
  readonly rule: StreamRule;
  readonly source: 'text' | 'thinking' | 'tool';
}

export interface IStreamRulesService {
  readonly _serviceBrand: undefined;

  /** Rules currently loaded (empty when the feature is disabled). */
  rules(): readonly StreamRule[];

  /** Names of rules already injected in this session (no repeat fire). */
  injectedRuleNames(): readonly string[];

  /**
   * Feed one streamed text/thinking delta. Returns the matches that fired
   * (each appended as a system reminder + recorded on the wire + a
   * continuation enqueued), or an empty array.
   */
  checkDelta(source: 'text' | 'thinking', delta: string): Promise<readonly StreamRuleMatch[]>;

  /** Match finalized tool-call arguments at step end. Same effects as checkDelta. */
  checkToolCall(toolName: string, argsText: string): Promise<readonly StreamRuleMatch[]>;

  /** Reload rules from disk (e.g. after the user edits `rules/`). */
  reload(): Promise<void>;
}

export const IStreamRulesService = createDecorator<IStreamRulesService>('streamRulesService');
