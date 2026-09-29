/**
 * Scenario: Yield tool validates against the declared schema and hands the payload over.
 * Responsibilities: verify schema accept/retry/override, error payloads, and take-once semantics.
 * Wiring: real Yield tool + session yield service; scope-context stub.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/features/yield.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { outputText } from './helpers';

import { DisposableStore } from '#/_base/di/lifecycle';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { ISessionYieldService } from '#/features/yield/yield';
import { SessionYieldService } from '#/features/yield/yieldService';
import { IYieldTool } from '#/features/yield/tools/yield/yield';
import { YieldTool } from '#/features/yield/tools/yield/yieldTool';

const SCHEMA = {
  type: 'object',
  properties: { files: { type: 'array', items: { type: 'string' } } },
  required: ['files'],
  additionalProperties: false,
};

describe('Yield — structured subagent output (src/features/yield)', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IAgentScopeContext, {
      _serviceBrand: undefined,
      agentId: 'sub-1',
      scope: (sub?: string) => (sub ? `agents/sub-1/${sub}` : 'agents/sub-1'),
    } satisfies IAgentScopeContext);
    ix.set(ISessionYieldService, new SyncDescriptor(SessionYieldService));
    ix.set(IYieldTool, new SyncDescriptor(YieldTool));
  });
  afterEach(() => disposables.dispose());

  async function execute(args: unknown) {
    const tool = ix.get(IYieldTool);
    const execution = await tool.resolveExecution(args as never);
    if ('execute' in execution) return execution.execute({ turnId: 1, toolCallId: 'c1', signal: new AbortController().signal });
    throw new Error('yield tool did not resolve to a runnable execution');
  }

  it('accepts a schema-conforming payload', async () => {
    ix.get(ISessionYieldService).declareSchema('sub-1', SCHEMA);
    const result = await execute({ data: { files: ['a.ts'] } });
    expect(result.isError).not.toBe(true);
    expect(result.stopTurn).toBe(true);
    const taken = ix.get(ISessionYieldService).take('sub-1');
    expect(taken).toMatchObject({ data: { files: ['a.ts'] } });
    expect(ix.get(ISessionYieldService).take('sub-1')).toBeUndefined();
  });

  it('rejects a violating payload with details, then accepts the fix', async () => {
    ix.get(ISessionYieldService).declareSchema('sub-1', SCHEMA);
    const bad = await execute({ data: { files: 'nope' } });
    expect(bad.isError).toBe(true);
    expect(outputText(bad)).toContain('output schema');
    expect(ix.get(ISessionYieldService).peek('sub-1')).toBeUndefined();
    const good = await execute({ data: { files: [] } });
    expect(good.isError).not.toBe(true);
    expect(ix.get(ISessionYieldService).take('sub-1')?.data).toEqual({ files: [] });
  });

  it('overrides after exhausting the in-tool retry budget', async () => {
    ix.get(ISessionYieldService).declareSchema('sub-1', SCHEMA);
    await execute({ data: { nope: 1 } });
    await execute({ data: { nope: 2 } });
    const third = await execute({ data: { nope: 3 } });
    expect(third.isError).not.toBe(true);
    expect(outputText(third)).toContain('override');
    expect(ix.get(ISessionYieldService).take('sub-1')).toMatchObject({ schemaOverridden: true });
  });

  it('records failures without a schema', async () => {
    const result = await execute({ error: 'could not find it', type: 'search' });
    expect(result.stopTurn).toBe(true);
    expect(ix.get(ISessionYieldService).take('sub-1')).toMatchObject({ error: 'could not find it' });
  });
});
