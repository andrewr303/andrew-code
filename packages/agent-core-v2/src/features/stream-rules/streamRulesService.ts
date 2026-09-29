/**
 * `stream-rules` domain — `IAgentStreamRulesService` implementation.
 *
 * Loads `rules/*.md` from the session workspace directory through `hostFs`,
 * matches streamed text/thinking deltas (buffered per step, checked
 * incrementally) and finalized tool-call arguments, and on a match appends
 * the rule body as a `<system-reminder>` through `systemReminder`, records
 * the name via the `streamRule.injected` wire op, and enqueues a
 * `ContinuationStepRequest` through `loop` so the model course-corrects in
 * the same turn. Each rule fires at most once per session (tracked through
 * the wire model's `injectedNames`, which also survives compaction and
 * replay). Subscribes `assistant.delta` / `thinking.delta` on the agent event
 * bus; tool args are matched at `onDidFinishStep` (via the tool executor's
 * post-execution hook) so non-streaming synthesized calls are still caught.
 * Bound at Agent scope — contributed into every Agent scope by
 * `StreamRulesFeature` (`features/stream-rules/streamRulesFeature`).
 */

import { Service } from '#/_base/di/service';
import { defineState } from '#/_base/state/stateRegistry';
import { IAgentLoopService } from '#/agent/loop/loop';
import { ContinuationStepRequest } from '#/agent/loop/stepRequest';
import { IAgentStateService } from '#/agent/state/agentState';
import { IAgentSystemReminderService } from '#/agent/systemReminder/systemReminder';
import { type ToolDidExecuteContext } from '#/agent/toolExecutor/toolHooks';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import { IEventBus } from '#/app/event/eventBus';
import { IFlagService } from '#/app/flag/flag';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import { IWireService } from '#/wire/wire';
import {
  IStreamRulesService,
  type StreamRule,
  type StreamRuleMatch,
} from './streamRules';
import { StreamRuleModel, streamRuleInjected } from './streamRuleOps';
import { STREAM_RULES_FLAG_ID } from './flag';

const RULE_BODY_LIMIT = 4000;

export const streamRulesBufferKey = defineState<string>(
  'streamRules.buffer',
  () => '',
);

export class AgentStreamRulesService extends Service implements IStreamRulesService {
  declare readonly _serviceBrand: undefined;

  private loaded: StreamRule[] = [];
  private loadAttempted = false;

  constructor(
    @IAgentSystemReminderService private readonly reminders: IAgentSystemReminderService,
    @IAgentLoopService private readonly loop: IAgentLoopService,
    @IAgentToolExecutorService toolExecutor: IAgentToolExecutorService,
    @IEventBus eventBus: IEventBus,
    @IFlagService private readonly flags: IFlagService,
    @IHostFileSystem private readonly hostFs: IHostFileSystem,
    @ISessionWorkspaceContext private readonly workspace: ISessionWorkspaceContext,
    @IWireService private readonly wire: IWireService,
    @IAgentStateService private readonly states: IAgentStateService,
  ) {
    super();
    this.states.register(streamRulesBufferKey);
    this._register(
      eventBus.subscribe('assistant.delta', (event) => {
        void this.checkDelta('text', event.delta);
      }),
    );
    this._register(
      eventBus.subscribe('thinking.delta', (event) => {
        void this.checkDelta('thinking', event.delta);
      }),
    );
    this._register(
      eventBus.subscribe('turn.started', () => {
        this.states.set(streamRulesBufferKey, '');
      }),
    );
    this._register(toolExecutor.hooks.onDidExecuteTool.register('stream-rules', async (ctx, next) => {
      await next();
      await this.checkToolResult(ctx);
    }));
    void this.reload().catch(() => undefined);
  }

  rules(): readonly StreamRule[] {
    return this.loaded;
  }

  injectedRuleNames(): readonly string[] {
    return this.wire.getModel(StreamRuleModel).current.injectedNames;
  }

  async checkDelta(
    source: 'text' | 'thinking',
    delta: string,
  ): Promise<readonly StreamRuleMatch[]> {
    await this.ensureLoaded();
    if (!this.flags.enabled(STREAM_RULES_FLAG_ID)) return [];
    if (this.loaded.length === 0 || delta.length === 0) return [];
    const buffer = `${this.states.get(streamRulesBufferKey)}${delta}`.slice(-8000);
    this.states.set(streamRulesBufferKey, buffer);
    const matches = this.matchFresh(buffer, source);
    await this.injectMatches(matches);
    return matches;
  }

  async checkToolCall(toolName: string, argsText: string): Promise<readonly StreamRuleMatch[]> {
    await this.ensureLoaded();
    if (!this.flags.enabled(STREAM_RULES_FLAG_ID)) return [];
    if (this.loaded.length === 0 || argsText.length === 0) return [];
    const matches = this.matchFresh(`${toolName} ${argsText}`, 'tool');
    await this.injectMatches(matches);
    return matches;
  }

  async reload(): Promise<void> {
    this.loadAttempted = true;
    this.loaded = await loadRules(this.hostFs, this.workspace.workDir);
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loadAttempted) await this.reload();
  }

  private matchFresh(haystack: string, source: StreamRuleMatch['source']): StreamRuleMatch[] {
    const injected = new Set(this.injectedRuleNames());
    const out: StreamRuleMatch[] = [];
    for (const rule of this.loaded) {
      if (injected.has(rule.name)) continue;
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(haystack)) {
        out.push({ rule, source });
        injected.add(rule.name);
      }
    }
    return out;
  }

  private async injectMatches(matches: readonly StreamRuleMatch[]): Promise<void> {
    if (matches.length === 0) return;
    const names = matches.map((match) => match.rule.name);
    this.wire.dispatch(streamRuleInjected({ names }));
    for (const match of matches) {
      this.reminders.appendSystemReminder(
        `Rule "${match.rule.name}" (matched ${match.source} output):\n${match.rule.body}`,
        { kind: 'injection', variant: 'stream-rule' },
      );
    }
    this.loop.enqueue(new ContinuationStepRequest());
  }

  private async checkToolResult(ctx: ToolDidExecuteContext): Promise<void> {
    if (ctx.outcome !== 'executed') return;
    const argsText = safeJson(ctx.args);
    if (argsText === undefined) return;
    await this.checkToolCall(ctx.toolCall.name, argsText);
  }

  get bufferForTests(): string {
    return this.states.get(streamRulesBufferKey);
  }
}

async function loadRules(hostFs: IHostFileSystem, workDir: string): Promise<StreamRule[]> {
  let entries: readonly { readonly name: string; readonly isFile: boolean }[];
  try {
    entries = await hostFs.readdir(`${workDir}/rules`);
  } catch {
    return [];
  }
  const rules: StreamRule[] = [];
  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith('.md')) continue;
    const name = entry.name.slice(0, -'.md'.length).trim();
    if (name.length === 0) continue;
    let body: string;
    try {
      body = (await hostFs.readText(`${workDir}/rules/${entry.name}`)).trim();
    } catch {
      continue;
    }
    if (body.length === 0) continue;
    rules.push({
      name,
      pattern: rulePatternFor(name, body),
      body: body.slice(0, RULE_BODY_LIMIT),
    });
  }
  return rules;
}

function rulePatternFor(name: string, body: string): RegExp {
  const firstLine = body.split('\n', 1)[0]?.trim() ?? '';
  const trigger = /^trigger\s*:\s*(.+)$/i.exec(firstLine)?.[1]?.trim();
  if (trigger !== undefined && trigger.length > 0) {
    try {
      return new RegExp(trigger, 'i');
    } catch {
      return new RegExp(`\\b${escapeRegExp(name.replaceAll('-', ' '))}\\b`, 'i');
    }
  }
  return new RegExp(`\\b${escapeRegExp(name.replaceAll('-', ' '))}\\b`, 'i');
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
}

function safeJson(value: unknown): string | undefined {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? undefined : text;
  } catch {
    return undefined;
  }
}

export { AgentStreamRulesService as StreamRules };
