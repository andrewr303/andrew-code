/**
 * `team` domain — `ITeamTool` contract.
 *
 * Public contract of the `Team` tool: the coordination surface over the
 * session task board. The lead creates tasks, fans work out through
 * `Agent` subagents, and collects their structured reports; subagents
 * claim tasks, update status, and submit findings. One tool, command
 * vocabulary mirrors oh-my-openagent's `team_task_*` family collapsed into
 * `command`. Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

export const TeamToolInputSchema = z
  .object({
    command: z
      .enum(['create_task', 'update_task', 'claim_task', 'list_tasks', 'submit_report', 'collect_reports', 'reset'])
      .describe('Board operation.'),
    id: z.string().optional().describe('Task id for update_task / claim_task.'),
    description: z.string().optional().describe('Task description for create_task.'),
    status: z.enum(['open', 'in_progress', 'resolved', 'cancelled']).optional().describe('New status for update_task.'),
    note: z.string().optional().describe('Progress note for update_task.'),
    task_ids: z.array(z.string()).optional().describe('Task ids a report resolves.'),
    content: z.string().optional().describe('Report content (Scope / Finding / Evidence / Confidence / Unresolved / Disconfirming).'),
    confidence: z.number().min(0).max(1).optional().describe('Report confidence 0-1.'),
    unresolved: z.string().optional().describe('What the report could not settle.'),
    disconfirming: z.string().optional().describe('Evidence that argues against the finding.'),
  })
  .strict();

export type TeamToolInput = z.infer<typeof TeamToolInputSchema>;

export interface ITeamTool extends AgentTool<TeamToolInput> {
  readonly _serviceBrand: undefined;
}
export const ITeamTool = createDecorator<ITeamTool>('teamTool');
