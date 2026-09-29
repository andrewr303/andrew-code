/**
 * `fusion` domain — `ISidekickTool` contract.
 *
 * Public contract of the `Sidekick` tool: hand a brief to the persistent
 * fusion sidekick (resume-or-spawn; mid-handoff briefs inject into the
 * running session). Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

export const SidekickToolInputSchema = z
  .object({
    brief: z
      .string()
      .min(1)
      .describe(
        'The work brief for the sidekick: goal, constraints, and success criteria. Briefs, not histories — the sidekick keeps its own context.',
      ),
    fresh: z
      .boolean()
      .optional()
      .describe('Start a fresh sidekick (drops its accumulated context) instead of resuming.'),
  })
  .strict();

export type SidekickToolInput = z.infer<typeof SidekickToolInputSchema>;

export interface ISidekickTool extends AgentTool<SidekickToolInput> {
  readonly _serviceBrand: undefined;
}
export const ISidekickTool = createDecorator<ISidekickTool>('sidekickTool');
