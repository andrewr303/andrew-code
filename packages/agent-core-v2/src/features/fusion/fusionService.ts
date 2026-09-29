/**
 * `fusion` domain — `IFusionService` implementation.
 *
 * Owns the sidekick agent lifecycle: the first handoff spawns a subagent
 * bound to the configured sidekick model (labels record the parent), and
 * every later handoff resumes the same agent so the sidekick keeps its
 * persistent, cache-friendly context. A brief arriving while the sidekick
 * is mid-handoff is injected into its running loop through the sidekick's
 * own `prompt` service (`inject`) instead of starting a second run — the
 * donor's mid-handoff interrupt. While fusion is on, the lead also gets
 * one guidance reminder per turn through `contextInjector` (delegate and
 * monitor; briefs not histories; keep the plan, ambiguity, and review),
 * and every `compaction.completed` boundary re-routes which of the two
 * configured models leads the session: a one-shot, tool-less classifier
 * request reads the recent context tail and answers HIGH or LOW; the
 * lead's model is swapped only between the two pairing members (a
 * user-chosen third model is never touched). Bound at Agent scope —
 * contributed by `FusionFeature` (`features/fusion/fusionFeature`).
 */

import { Service } from '#/_base/di/service';
import { IAgentContextInjectorService, type ContextInjectionProvider } from '#/agent/contextInjector/contextInjector';
import type { ContextMessage } from '#/agent/contextMemory/types';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentContextProjectorService } from '#/agent/contextProjector/contextProjector';
import { IAgentLLMRequesterService } from '#/agent/llmRequester/llmRequester';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentPromptService } from '#/agent/prompt/prompt';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentUserToolService } from '#/agent/userTool/userTool';
import { IConfigService } from '#/app/config/config';
import { IEventBus } from '#/app/event/eventBus';
import { IFlagService } from '#/app/flag/flag';
import type { Message } from '#/kosong/contract/message';
import { IModelCatalog } from '#/kosong/model/catalog';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { subagentLabels } from '#/session/agentLifecycle/subagentMetadata';
import { ISessionSubagentService } from '#/session/subagent/subagent';

import {
  DEFAULT_FUSION_CONFIG,
  FUSION_SECTION,
  type FusionConfig,
} from './configSection';
import { FUSION_FLAG_ID } from './flag';
import { IFusionService, type HandoffResult } from './fusion';
import { ISessionFusionTeamService } from './fusionTeam';
import LEAD_GUIDANCE from './lead-guidance.md?raw';
import { DEFAULT_PROFILE_NAME } from '#/agent/tools/agent/agent';

const HANDOFF_ORIGIN = { kind: 'system_trigger', name: 'fusion-handoff' } as const;
const CLASSIFIER_SYSTEM_PROMPT = [
  'You are a routing classifier for a coding agent session. Given the recent context tail, answer with exactly one word:',
  'HIGH — the upcoming work needs deep reasoning, architecture decisions, or ambiguous interpretation.',
  'LOW — the upcoming work is mechanical implementation, routine edits, or verification.',
  'Reply with only HIGH or LOW.',
].join('\n');

export class AgentFusionService extends Service implements IFusionService {
  declare readonly _serviceBrand: undefined;

  private sidekickAgentId: string | undefined;
  private routing = false;

  constructor(
    @IConfigService private readonly configService: IConfigService,
    @IFlagService private readonly flags: IFlagService,
    @IModelCatalog private readonly modelCatalog: IModelCatalog,
    @IAgentProfileService private readonly profile: IAgentProfileService,
    @IAgentLifecycleService private readonly lifecycle: IAgentLifecycleService,
    @ISessionSubagentService private readonly subagents: ISessionSubagentService,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
    @IAgentPermissionModeService private readonly permissionMode: IAgentPermissionModeService,
    @IAgentLLMRequesterService private readonly llmRequester: IAgentLLMRequesterService,
    @IAgentContextMemoryService private readonly context: IAgentContextMemoryService,
    @IAgentContextProjectorService private readonly projector: IAgentContextProjectorService,
    @IAgentContextInjectorService injector: IAgentContextInjectorService,
    @IEventBus private readonly eventBus: IEventBus,
    @ISessionFusionTeamService private readonly team: ISessionFusionTeamService,
  ) {
    super();
    this._register(injector.register('fusion-lead-guidance', this.guidanceProvider()));
    this._register(
      this.eventBus.subscribe('compaction.completed', () => {
        void this.routeAfterCompaction().catch(() => undefined);
      }),
    );
  }

  private fusionConfig(): FusionConfig {
    return {
      ...DEFAULT_FUSION_CONFIG,
      ...this.configService.get<FusionConfig | undefined>(FUSION_SECTION),
    };
  }

  enabled(): boolean {
    if (!this.flags.enabled(FUSION_FLAG_ID)) return false;
    return this.fusionConfig().enabled === true;
  }

  pairing(): { leadModel: string; sidekickModel: string } | undefined {
    const config = this.fusionConfig();
    for (const model of [config.leadModel!, config.sidekickModel!]) {
      try {
        this.modelCatalog.get(model);
      } catch {
        return undefined;
      }
    }
    return { leadModel: config.leadModel!, sidekickModel: config.sidekickModel! };
  }

  async handoff(brief: string, options: { readonly signal?: AbortSignal } = {}): Promise<HandoffResult> {
    const pairing = this.pairing();
    if (pairing === undefined) {
      return { status: 'failed', report: 'Fusion is not available: the lead or sidekick model is not configured.' };
    }
    const existing = this.sidekickAgentId !== undefined ? this.lifecycle.get(this.sidekickAgentId) : undefined;
    if (existing !== undefined) {
      const loop = existing.accessor.get(IAgentLoopService);
      if (loop.status().state === 'running') {
        const prompt = existing.accessor.get(IAgentPromptService);
        await prompt.inject({
          role: 'user',
          content: [{ type: 'text', text: `Additional brief from the lead (continue your handoff and cover this too):\n${brief}` }],
          toolCalls: [],
          origin: HANDOFF_ORIGIN,
        } satisfies ContextMessage);
        return {
          status: 'injected',
          report: 'The sidekick is mid-handoff; the new brief was injected into its running session. Its next report will cover it.',
        };
      }
      return this.runBrief(existing.id, brief, options.signal);
    }

    const requester = this.lifecycle.get(this.scopeContext.agentId);
    if (requester === undefined) {
      return { status: 'failed', report: 'Fusion handoff failed: the lead agent is not registered.' };
    }
    let created;
    try {
      created = await this.lifecycle.create({
        binding: { profile: DEFAULT_PROFILE_NAME, model: pairing.sidekickModel },
        labels: subagentLabels(this.scopeContext.agentId),
      });
    } catch {
      return { status: 'failed', report: 'Fusion handoff failed: the sidekick agent could not be created.' };
    }
    created.accessor.get(IAgentPermissionModeService).setMode(this.permissionMode.mode);
    created.accessor
      .get(IAgentUserToolService)
      .inheritUserTools(requester.accessor.get(IAgentUserToolService));
    this.sidekickAgentId = created.id;
    return this.runBrief(created.id, brief, options.signal);
  }

  async resetSidekick(): Promise<void> {
    this.sidekickAgentId = undefined;
  }

  private async runBrief(
    agentId: string,
    brief: string,
    signal?: AbortSignal,
  ): Promise<HandoffResult> {
    try {
      const run = await this.subagents.run(
        agentId,
        { kind: 'prompt', prompt: brief },
        { signal: signal ?? new AbortController().signal },
      );
      const outcome = await run.completion;
      return { status: 'completed', report: outcome.summary };
    } catch (error) {
      return {
        status: 'failed',
        report: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private guidanceProvider(): ContextInjectionProvider {
    return async ({ isNewTurn }) => {
      if (!this.enabled() || !isNewTurn || (await this.team.status()).enabled) return undefined;
      return LEAD_GUIDANCE.trim();
    };
  }

  private async routeAfterCompaction(): Promise<void> {
    const config = this.fusionConfig();
    if (!this.enabled() || config.routing !== true || this.routing || (await this.team.status()).enabled) return;
    this.routing = true;
    try {
      const tail = this.recentTail();
      if (tail.length === 0) return;
      const finish = await this.llmRequester.request(
        {
          messages: tail,
          tools: [],
          systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
          source: { type: 'operation', requestKind: 'fusion_routing' },
        },
        undefined,
        AbortSignal.timeout(30_000),
      );
      const answer = finish.message.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim()
        .toUpperCase();
      if ((answer !== 'HIGH' && answer !== 'LOW') || (await this.team.status()).enabled) return;
      const pairing = this.pairing();
      if (pairing === undefined) return;
      const current = this.profile.getModel();
      if (answer === 'HIGH' && current === pairing.sidekickModel) {
        await this.profile.setModel(pairing.leadModel);
      } else if (answer === 'LOW' && current === pairing.leadModel) {
        await this.profile.setModel(pairing.sidekickModel);
      }
    } catch {
      // Routing is best-effort: a failed classifier keeps the current model.
    } finally {
      this.routing = false;
    }
  }

  private recentTail(): readonly Message[] {
    const history: readonly ContextMessage[] = this.context.get();
    if (history.length === 0) return [];
    try {
      return this.projector.project(history.slice(-12));
    } catch {
      return [];
    }
  }
}

export { AgentFusionService as Fusion };
