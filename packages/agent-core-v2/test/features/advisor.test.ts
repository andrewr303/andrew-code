/**
 * Scenario: advisor reviews a finished turn and injects notes; silence stays silent.
 * Responsibilities: verify note parsing/injection and the inert-when-disabled path.
 * Wiring: real advisor service; projector/llm/profile/config/catalog/flags/memory stubs.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/features/advisor.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentContextProjectorService } from '#/agent/contextProjector/contextProjector';
import { IAgentLLMRequesterService } from '#/agent/llmRequester/llmRequester';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentSystemReminderService } from '#/agent/systemReminder/systemReminder';
import { AgentSystemReminderService } from '#/agent/systemReminder/systemReminderService';
import { IConfigService } from '#/app/config/config';
import { IEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';
import { IFlagService } from '#/app/flag/flag';
import { IModelCatalog } from '#/kosong/model/catalog';
import type { Message } from '#/kosong/contract/message';
import { IAdvisorService } from '#/features/advisor/advisor';
import { AgentAdvisorService } from '#/features/advisor/advisorService';

import { stubContextMemory } from '../agent/contextMemory/stubs';
import { stubLoopWithHooks } from '../agent/loop/stubs';
import { stubFlag } from '../app/flag/stubs';
import { registerTestAgentWire, testWireScope } from '../wire/stubs';

function textMessage(text: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    toolCalls: [],
  };
}

describe('Advisor — second-model review (src/features/advisor)', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let reviewText: string;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    reviewText = 'ok';
    ix.stub(IAgentContextMemoryService, stubContextMemory());
    ix.stub(IAgentContextProjectorService, {
      _serviceBrand: undefined,
      project: (messages: readonly unknown[]) => messages as Message[],
      projectStrict: () => [],
      projectMediaDegraded: () => [],
    } as unknown as IAgentContextProjectorService);
    ix.stub(IAgentLLMRequesterService, {
      _serviceBrand: undefined,
      prepareTurnConfig: () => undefined,
      request: async () => ({ message: textMessage(reviewText), usage: {} }),
      start: () => ({ trace: {}, result: Promise.resolve({ message: textMessage(reviewText), usage: {} }) }),
    } as unknown as IAgentLLMRequesterService);
    ix.stub(IAgentLoopService, stubLoopWithHooks());
    ix.stub(IAgentProfileService, {
      _serviceBrand: undefined,
      data: () => ({ modelAlias: 'primary-model', thinkingLevel: 'medium' }),
    } as unknown as IAgentProfileService);
    ix.stub(IConfigService, { _serviceBrand: undefined, get: () => undefined } as unknown as IConfigService);
    ix.set(IEventBus, new SyncDescriptor(EventBusService));
    ix.stub(IFlagService, stubFlag(true));
    ix.stub(IModelCatalog, {
      _serviceBrand: undefined,
      get: () => ({ capabilities: {} }),
    } as unknown as IModelCatalog);
    registerTestAgentWire(ix, testWireScope('wire', 'advisor-test'));
    ix.set(IAgentSystemReminderService, new SyncDescriptor(AgentSystemReminderService));
    ix.set(IAdvisorService, new SyncDescriptor(AgentAdvisorService));
  });
  afterEach(() => disposables.dispose());

  it('injects parsed notes as system reminders', async () => {
    reviewText = 'aside: consider a null check\nconcern: the retry has no backoff';
    const memory = ix.get(IAgentContextMemoryService);
    memory.append({
      role: 'user',
      content: [{ type: 'text', text: 'do the thing' }],
      toolCalls: [],
    } as never);
    const service = ix.get(IAdvisorService);
    expect(service.enabled()).toBe(true);
    const notes = await service.reviewTurn(1);
    expect(notes).toHaveLength(2);
    expect(notes[0]).toMatchObject({ severity: 'aside' });
    expect(memory.get().length).toBe(3);
    expect(JSON.stringify(memory.get())).toContain('Advisor concern');
  });

  it('stays silent on an ok review', async () => {
    reviewText = 'ok';
    const memory = ix.get(IAgentContextMemoryService);
    memory.append({
      role: 'user',
      content: [{ type: 'text', text: 'do the thing' }],
      toolCalls: [],
    } as never);
    const service = ix.get(IAdvisorService);
    const notes = await service.reviewTurn(1);
    expect(notes).toEqual([]);
    expect(memory.get().length).toBe(1);
  });

  it('is inert when the flag is off', async () => {
    ix.stub(IFlagService, stubFlag(false));
    const service = ix.get(IAdvisorService);
    expect(service.enabled()).toBe(false);
    reviewText = 'blocker: everything is broken';
    expect(await service.reviewTurn(1)).toEqual([]);
    expect(ix.get(IAgentContextMemoryService).get()).toEqual([]);
  });

  it('enqueues a steer message on a blocker', async () => {
    reviewText = 'blocker: data loss on retry';
    ix.get(IAgentContextMemoryService).append({
      role: 'user',
      content: [{ type: 'text', text: 'do the thing' }],
      toolCalls: [],
    } as never);
    const service = ix.get(IAdvisorService);
    await service.reviewTurn(1);
    const loop = ix.get(IAgentLoopService) as ReturnType<typeof stubLoopWithHooks>;
    expect(loop.queue.hasPendingRequests()).toBe(true);
  });
});
