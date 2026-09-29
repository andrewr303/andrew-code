/**
 * `team` domain — `ITeamTool` implementation.
 *
 * Maps the tool's command vocabulary onto `ISessionTeamBoardService` with
 * the caller's own agent id (`scopeContext`) attached to claims and
 * reports, so the board records who did what without trusting the model
 * to self-identify. Task and report listings render as compact JSON the
 * model parses directly. Bound at Agent scope.
 */

import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';

import DESCRIPTION from './team.md?raw';
import { ISessionTeamBoardService } from '../../team';
import { ITeamTool, TeamToolInputSchema, type TeamToolInput } from './team';

export class TeamTool implements ITeamTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Team' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(TeamToolInputSchema);

  constructor(
    @ISessionTeamBoardService private readonly board: ISessionTeamBoardService,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
  ) {}

  resolveExecution(args: TeamToolInput): ToolExecution {
    return {
      description: `Team board ${args.command}`,
      accesses: [],
      approvalRule: this.name,
      execute: async () => this.execution(args),
    };
  }

  private async execution(args: TeamToolInput) {
    switch (args.command) {
      case 'create_task': {
        if (args.description === undefined) return missing('description');
        const task = this.board.addTask(args.description, args.id !== undefined ? { id: args.id } : undefined);
        return { output: `Created task ${task.id}: ${task.description}` };
      }
      case 'update_task': {
        if (args.id === undefined) return missing('id');
        const task = this.board.updateTask(args.id, {
          ...(args.status !== undefined ? { status: args.status } : {}),
          ...(args.note !== undefined ? { note: args.note } : {}),
        });
        if (task === undefined) return notFound(args.id);
        return { output: `Task ${task.id}: ${task.status}${task.note !== undefined ? ` — ${task.note}` : ''}` };
      }
      case 'claim_task': {
        if (args.id === undefined) return missing('id');
        const task = this.board.claimTask(args.id, this.scopeContext.agentId);
        if (task === undefined) {
          return { isError: true, output: `Task ${args.id} is not open (already claimed or done). Pick another.` };
        }
        return { output: `Claimed task ${task.id}. You own it — start work.` };
      }
      case 'list_tasks': {
        return { output: renderTasks(this.board.listTasks()) };
      }
      case 'submit_report': {
        if (args.content === undefined) return missing('content');
        const report = this.board.submitReport({
          agentId: this.scopeContext.agentId,
          taskIds: args.task_ids ?? [],
          content: args.content,
          ...(args.confidence !== undefined ? { confidence: args.confidence } : {}),
          ...(args.unresolved !== undefined ? { unresolved: args.unresolved } : {}),
          ...(args.disconfirming !== undefined ? { disconfirming: args.disconfirming } : {}),
        });
        return { output: `Report recorded (${report.taskIds.length} task(s) resolved).` };
      }
      case 'collect_reports': {
        const reports = this.board.collectReports();
        if (reports.length === 0) {
          return { output: 'No reports waiting. Pending tasks: ' + openCount(this.board) };
        }
        return { output: JSON.stringify(reports, null, 2) };
      }
      case 'reset': {
        this.board.reset();
        return { output: 'Board cleared.' };
      }
    }
  }
}

function missing(param: string): { output: string; isError: true } {
  return { isError: true, output: `Missing required parameter "${param}".` };
}

function notFound(id: string): { output: string; isError: true } {
  return { isError: true, output: `Task ${id} not found.` };
}

function openCount(board: ISessionTeamBoardService): number {
  return board.listTasks().filter((task) => task.status === 'open').length;
}

function renderTasks(tasks: readonly ReturnType<ISessionTeamBoardService['task']>[]): string {
  const present = tasks.filter((task): task is NonNullable<typeof task> => task !== undefined);
  if (present.length === 0) return 'Board is empty.';
  return present
    .map((task) => `- ${task.id} [${task.status}] ${task.description}${task.owner !== undefined ? ` (owner: ${task.owner})` : ''}`)
    .join('\n');
}
