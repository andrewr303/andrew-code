/**
 * Scenario: stream-rules fire once per rule — delta match, tool-arg match, no repeat.
 * Responsibilities: verify reminder injection, wire recording, and continuation enqueue.
 * Wiring: real stream-rules service; loop/executor/memory/host-fs/workspace stubs.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/features/stream-rules.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentLoopService } from '#/agent/loop/loop';
import { IAgentStateService } from '#/agent/state/agentState';
import { AgentStateService } from '#/agent/state/agentStateService';
import { IAgentSystemReminderService } from '#/agent/systemReminder/systemReminder';
import { AgentSystemReminderService } from '#/agent/systemReminder/systemReminderService';
import { type ToolDidExecuteContext } from '#/agent/toolExecutor/toolHooks';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import { IEventBus } from '#/app/event/eventBus';
import { EventBusService } from '#/app/event/eventBusService';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import { IWireService } from '#/wire/wire';
import { IFlagService } from '#/app/flag/flag';
import { IStreamRulesService } from '#/features/stream-rules/streamRules';
import { AgentStreamRulesService } from '#/features/stream-rules/streamRulesService';
import { StreamRuleModel } from '#/features/stream-rules/streamRuleOps';

import { stubContextMemory } from '../agent/contextMemory/stubs';
import { stubLoopWithHooks } from '../agent/loop/stubs';
import { stubFlag } from '../app/flag/stubs';
import { stubToolExecutorEvents, type ToolExecutorEventStubs } from '../agent/toolExecutor/stubs';
import { registerTestAgentWire, testWireScope } from '../wire/stubs';

function stubHostFs(files: Record<string, string>): IHostFileSystem {
  return {
    _serviceBrand: undefined,
    readdir: async (path: string) => {
      if (!path.endsWith('/rules')) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return Object.keys(files).map((name) => ({ name, isFile: true, isDirectory: false }));
    },
    readText: async (path: string) => {
      const name = path.split('/').at(-1) ?? '';
      const body = files[name];
      if (body === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return body;
    },
  } as unknown as IHostFileSystem;
}

function toolCtx(): ToolDidExecuteContext {
  return {
    turnId: 1,
    signal: new AbortController().signal,
    toolCall: { type: 'function', id: 'call_1', name: 'Write', arguments: '{}' },
    toolCalls: [],
    args: { path: 'src/foo.ts', content: 'use Box::leak here' },
    outcome: 'executed',
    result: { output: 'ok' },
  };
}

describe('StreamRules — time-traveling stream rules (src/features/stream-rules)', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let executorEvents: ToolExecutorEventStubs;
  let loop: ReturnType<typeof stubLoopWithHooks>;
  const files = {
    'box-leak.md': 'trigger: Box::leak\nDo not reach for Box::leak in production code paths.',
  };

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IAgentContextMemoryService, stubContextMemory());
    ix.set(IEventBus, new (EventBusService as unknown as new () => IEventBus)());
    loop = stubLoopWithHooks();
    ix.stub(IAgentLoopService, loop);
    executorEvents = stubToolExecutorEvents();
    ix.stub(IAgentToolExecutorService, executorEvents.executor);
    ix.stub(IHostFileSystem, stubHostFs(files));
    ix.stub(IFlagService, stubFlag(true));
    ix.stub(ISessionWorkspaceContext, { workDir: '/work' } as ISessionWorkspaceContext);
    ix.set(IAgentStateService, new SyncDescriptor(AgentStateService));
    registerTestAgentWire(ix, testWireScope('wire', 'stream-rules-test'));
    ix.set(IAgentSystemReminderService, new SyncDescriptor(AgentSystemReminderService));
    ix.set(IStreamRulesService, new SyncDescriptor(AgentStreamRulesService));
  });
  afterEach(() => disposables.dispose());

  it('injects a reminder + continuation on a streamed text match', async () => {
    const service = ix.get(IStreamRulesService);
    const wire = ix.get(IWireService);
    await service.reload();
    expect(service.rules().map((rule) => rule.name)).toEqual(['box-leak']);

    const matches = await service.checkDelta('text', 'about to write Box::leak here');
    expect(matches.map((match) => match.rule.name)).toEqual(['box-leak']);

    const memory = ix.get(IAgentContextMemoryService);
    expect(
      memory.get().some((message) => JSON.stringify(message).includes('box-leak')),
    ).toBe(true);
    expect(wire.getModel(StreamRuleModel).current.injectedNames).toEqual(['box-leak']);
    expect(loop.queue.hasPendingRequests()).toBe(true);
  });

  it('does not fire the same rule twice', async () => {
    const service = ix.get(IStreamRulesService);
    await service.reload();
    await service.checkDelta('text', 'Box::leak again');
    const second = await service.checkDelta('text', 'Box::leak once more');
    expect(second).toEqual([]);
  });

  it('matches finalized tool arguments through the executor hook', async () => {
    const service = ix.get(IStreamRulesService);
    await service.reload();
    await executorEvents.didExecuteSlot.run(toolCtx());
    expect(service.injectedRuleNames()).toEqual(['box-leak']);
  });
});
