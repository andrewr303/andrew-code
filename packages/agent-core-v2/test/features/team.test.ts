/**
 * Scenario: team board — task lifecycle, exclusive claims, report drain, and agent attribution.
 * Responsibilities: verify board CRUD, claim exclusivity, collect-once reports, tool command surface.
 * Wiring: real team service + tool with stubbed scope context.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/features/team.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { SyncDescriptor } from '#/_base/di/descriptors';
import { TestInstantiationService } from '#/_base/di/test';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { ISessionTeamBoardService } from '#/features/team/team';
import { SessionTeamBoardService } from '#/features/team/teamService';
import { ITeamTool } from '#/features/team/tools/team/team';
import { TeamTool } from '#/features/team/tools/team/teamTool';
import type { ExecutableToolContext, ToolExecution } from '#/tool/toolContract';

const signal = new AbortController().signal;

describe('team — Agent Team task board (src/features/team)', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let agentId = 'lead';

  beforeEach(() => {
    disposables = new DisposableStore();
    ix = disposables.add(new TestInstantiationService());
    ix.stub(IAgentScopeContext, {
      _serviceBrand: undefined,
      get agentId() {
        return agentId;
      },
      scope: (sub?: string) => (sub ? `agents/x/${sub}` : 'agents/x'),
    } as unknown as IAgentScopeContext);
    ix.set(ISessionTeamBoardService, new SyncDescriptor(SessionTeamBoardService));
    ix.set(ITeamTool, new SyncDescriptor(TeamTool));
  });
  afterEach(() => disposables.dispose());

  async function exec(args: unknown): Promise<{ output: string; isError?: boolean }> {
    const tool = ix.get(ITeamTool);
    const execution: ToolExecution = await tool.resolveExecution(args as never);
    if (!('execute' in execution)) throw new Error('not runnable');
    const result = await execution.execute({ turnId: 1, toolCallId: 'c1', signal } satisfies ExecutableToolContext);
    const output = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    return { output, isError: result.isError === true ? true : undefined };
  }

  it('creates, claims, and transitions tasks', async () => {
    await exec({ command: 'create_task', description: 'Map the exports' });
    const claimed = await exec({ command: 'claim_task', id: 't1' });
    expect(claimed.isError).not.toBe(true);
    const board = ix.get(ISessionTeamBoardService);
    expect(board.task('t1')).toMatchObject({ status: 'in_progress', owner: 'lead' });
    await exec({ command: 'update_task', id: 't1', status: 'resolved', note: 'done' });
    expect(board.task('t1')).toMatchObject({ status: 'resolved' });
  });

  it('rejects a claim on an owned task', async () => {
    await exec({ command: 'create_task', description: 'One owner only' });
    agentId = 'member-a';
    await exec({ command: 'claim_task', id: 't1' });
    agentId = 'member-b';
    const second = await exec({ command: 'claim_task', id: 't1' });
    expect(second.isError).toBe(true);
    expect(second.output).toContain('not open');
    expect(ix.get(ISessionTeamBoardService).task('t1')?.owner).toBe('member-a');
  });

  it('submit_report resolves tasks and collect drains once', async () => {
    await exec({ command: 'create_task', description: 'Find exports' });
    agentId = 'member-a';
    await exec({ command: 'claim_task', id: 't1' });
    const submitted = await exec({
      command: 'submit_report',
      task_ids: ['t1'],
      content: 'Finding: exports are X and Y.',
      confidence: 0.8,
      unresolved: 'barrel file origin',
    });
    expect(submitted.isError).not.toBe(true);
    expect(ix.get(ISessionTeamBoardService).task('t1')).toMatchObject({ status: 'resolved' });

    agentId = 'lead';
    const first = await exec({ command: 'collect_reports' });
    expect(first.output).toContain('member-a');
    expect(first.output).toContain('Finding: exports are X and Y.');
    const second = await exec({ command: 'collect_reports' });
    expect(second.isError).not.toBe(true);
    expect(second.output).toContain('No reports waiting');
  });

  it('reset clears the board', async () => {
    await exec({ command: 'create_task', description: 'temporary' });
    await exec({ command: 'reset' });
    expect(ix.get(ISessionTeamBoardService).listTasks()).toEqual([]);
  });
});
