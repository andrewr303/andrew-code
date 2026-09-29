/**
 * `yield` domain — `IYieldTool` contract.
 *
 * Public contract of the `Yield` tool: the input schema the model-facing
 * parameters are derived from (a success `data` payload or a failure
 * `error`, plus an optional `type` section label), and the Agent-scope
 * identifier the implementation registers against. Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

export const YieldToolInputSchema = z
  .object({
    data: z.unknown().optional().describe('Structured result payload. Must satisfy the parent-declared output schema when one was given.'),
    error: z.string().optional().describe('Failure message when the task could not be completed.'),
    type: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .describe('Optional result section or classification label.'),
  })
  .strict();

export type YieldToolInput = z.infer<typeof YieldToolInputSchema>;

export interface IYieldTool extends AgentTool<YieldToolInput> {
  readonly _serviceBrand: undefined;
}
export const IYieldTool = createDecorator<IYieldTool>('yieldTool');
