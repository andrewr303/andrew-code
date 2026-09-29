/**
 * Scenario: fusion pairing, persistent sidekick handoffs, mid-handoff injection, compaction routing.
 * Responsibilities: verify spawn-vs-resume, injection into running handoffs, and model switching.
 * Wiring: real fusion service; lifecycle/subagent/profile/catalog/requester/memory stubs.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/features/fusion.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentContextInjectorService } from '#/agent/contextInjector/contextInjector';
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
import { EventBusService } from '#/app/event/eventBusService';
import { IFlagService } from '#/app/flag/flag';
import { IModelCatalog } from '#/kosong/model/catalog';
import type { Message } from '#/kosong/contract/message';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { ISessionSubagentService } from '#/session/subagent/subagent';
import { IFusionService } from '#/features/fusion/fusion';
import { ISessionFusionTeamService } from '#/features/fusion/fusionTeam';
import { AgentFusionService } from '#/features/fusion/fusionService';
import { ISidekickTool } from '#/features/fusion/tools/sidekick/sidekick';
import { SidekickTool } from '#/features/fusion/tools/sidekick/sidekickTool';

import { stubContextMemory } from '../agent/contextMemory/stubs';
import { stubFlag } from '../app/flag/stubs';

const LEAD = 'gpt-6-astra';
const SIDEKICK = 'cloudflare-workers-ai/@cf/zai-org/glm-5.3-flash';

describe('fusion — lead + sidekick pairing (src/features/fusion)', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let created: { id: string; model: string }[];
  let running: boolean;
  let injected: string[];
  let runs: { agentId: string; prompt: string }[];
  let currentModel: string;
  let classifierAnswer: string;

  function fakeScope(id: string) {
    return {
      id,
      accessor: {
        get: (token: unknown) => {
          if (token === IAgentLoopService) {
            return { status: () => ({ state: running ? 'running' : 'idle' }) };
          }
          if (token === IAgentPromptService) {
            return {
              inject: async (message: { content: readonly { type: string; text?: string }[] }) => {
                injected.push(message.content.map((part) => part.text ?? '').join(''));
              },
            };
          }
          if (token === IAgentPermissionModeService) return { setMode: () => {} };
          if (token === IAgentUserToolService) return { inheritUserTools: () => {} };
          if (token === IAgentProfileService) return { getModel: () => currentModel };
          return undefined;
        },
      },
    };
  }

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    created = [];
    running = false;
    injected = [];
    runs = [];
    currentModel = LEAD;
    classifierAnswer = 'LOW';

    ix.stub(IConfigService, {
      _serviceBrand: undefined,
      get: () => ({ enabled: true, leadModel: LEAD, sidekickModel: SIDEKICK, routing: true }),
    } as unknown as IConfigService);
    ix.stub(IFlagService, stubFlag(true));
    ix.stub(IModelCatalog, {
      _serviceBrand: undefined,
      get: (id: string) => ({ id, capabilities: {} }),
    } as unknown as IModelCatalog);
    ix.stub(IAgentProfileService, {
      _serviceBrand: undefined,
      getModel: () => currentModel,
      setModel: async (model: string) => {
        currentModel = model;
        return { model };
      },
    } as unknown as IAgentProfileService);
    ix.stub(IAgentLifecycleService, {
      _serviceBrand: undefined,
      get: (id: string) =>
        id === 'lead' || created.some((agent) => agent.id === id)
          ? fakeScope(id)
          : undefined,
      create: async (opts: { binding: { model: string } }) => {
        const agent = { id: `side-${String(created.length + 1)}`, model: opts.binding.model };
        created.push(agent);
        return fakeScope(agent.id);
      },
    } as unknown as IAgentLifecycleService);
    ix.stub(ISessionSubagentService, {
      _serviceBrand: undefined,
      run: async (agentId: string, request: { prompt: string }) => {
        runs.push({ agentId, prompt: request.prompt });
        return {
          agentId,
          completion: Promise.resolve({ summary: `done: ${request.prompt}` }),
        };
      },
    } as unknown as ISessionSubagentService);
    ix.stub(IAgentScopeContext, {
      _serviceBrand: undefined,
      agentId: 'lead',
      scope: (sub?: string) => (sub ? `agents/lead/${sub}` : 'agents/lead'),
    } as unknown as IAgentScopeContext);
    ix.stub(IAgentPermissionModeService, {
      _serviceBrand: undefined,
      mode: 'auto',
      setMode: () => {},
    } as unknown as IAgentPermissionModeService);
    ix.stub(IAgentLLMRequesterService, {
      _serviceBrand: undefined,
      request: async () => ({
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: classifierAnswer }],
          toolCalls: [],
        } as Message,
        usage: {},
      }),
    } as unknown as IAgentLLMRequesterService);
    ix.stub(IAgentContextMemoryService, stubContextMemory());
    ix.stub(IAgentContextProjectorService, {
      _serviceBrand: undefined,
      project: (messages: readonly unknown[]) => messages as Message[],
      projectStrict: () => [],
      projectMediaDegraded: () => [],
    } as unknown as IAgentContextProjectorService);
    ix.stub(IAgentContextInjectorService, {
      _serviceBrand: undefined,
      register: () => ({ dispose: () => {} }),
      injectAfterCompaction: async () => {},
    } as unknown as IAgentContextInjectorService);
    ix.stub(ISessionFusionTeamService, { status: async () => ({ enabled: false }) });
    ix.set(IEventBus, new SyncDescriptor(EventBusService));
    ix.set(IFusionService, new SyncDescriptor(AgentFusionService));
    ix.set(ISidekickTool, new SyncDescriptor(SidekickTool));
  });
  afterEach(() => disposables.dispose());

  it('resolves the configured pairing and spawns once, then resumes', async () => {
    const fusion = ix.get(IFusionService);
    expect(fusion.pairing()).toEqual({ leadModel: LEAD, sidekickModel: SIDEKICK });
    const first = await fusion.handoff('implement the retry helper');
    expect(first.status).toBe('completed');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ model: SIDEKICK });
    const second = await fusion.handoff('now add tests for it');
    expect(second.status).toBe('completed');
    expect(created).toHaveLength(1);
    expect(runs.map((run) => run.agentId)).toEqual([created[0]!.id, created[0]!.id]);
  });

  it('injects a brief into a running handoff instead of queueing', async () => {
    const fusion = ix.get(IFusionService);
    await fusion.handoff('first brief');
    running = true;
    const second = await fusion.handoff('also handle the edge case');
    expect(second.status).toBe('injected');
    expect(runs).toHaveLength(1);
    expect(injected).toHaveLength(1);
    expect(injected[0]).toContain('edge case');
  });

  it('resetSidekick makes the next handoff spawn fresh', async () => {
    const fusion = ix.get(IFusionService);
    await fusion.handoff('brief one');
    await fusion.resetSidekick();
    await fusion.handoff('brief two');
    expect(created).toHaveLength(2);
  });

  it('routes to the cheaper model after a LOW compaction verdict', async () => {
    const fusion = ix.get(IFusionService);
    expect(fusion.enabled()).toBe(true);
    ix.get(IAgentContextMemoryService).append({
      role: 'user',
      content: [{ type: 'text', text: 'mechanical refactor' }],
      toolCalls: [],
    } as never);
    ix.get(IEventBus).publish({ type: "compaction.completed", result: { summary: "s", compactedCount: 0, tokensBefore: 0, tokensAfter: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(currentModel).toBe(SIDEKICK);

    classifierAnswer = 'HIGH';
    ix.get(IEventBus).publish({ type: "compaction.completed", result: { summary: "s", compactedCount: 0, tokensBefore: 0, tokensAfter: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(currentModel).toBe(LEAD);
  });

  it('does not let legacy compaction routing downgrade an active team leader', async () => {
    ix.stub(ISessionFusionTeamService, { status: async () => ({ enabled: true }) });
    ix.get(IFusionService);
    ix.get(IAgentContextMemoryService).append({ role: 'user', content: [{ type: 'text', text: 'routine work' }], toolCalls: [] } as never);
    ix.get(IEventBus).publish({ type: 'compaction.completed', result: { summary: 's', compactedCount: 0, tokensBefore: 0, tokensAfter: 0 } });
    await Promise.resolve();
    await Promise.resolve();
    expect(currentModel).toBe(LEAD);
  });

  it('reports a clear error through the tool when fusion is off', async () => {
    ix.stub(IFlagService, stubFlag(false));
    const tool = ix.get(ISidekickTool);
    const execution = await tool.resolveExecution({ brief: 'x' });
    if (!('execute' in execution)) throw new Error('not runnable');
    const result = await execution.execute({
      turnId: 1,
      toolCallId: 'c1',
      signal: new AbortController().signal,
    });
    expect(result.isError).toBe(true);
    expect(vi.isMockFunction).toBeDefined();
    expect(typeof result.output === 'string' ? result.output : JSON.stringify(result.output)).toContain('Fusion is not enabled');
  });
});
