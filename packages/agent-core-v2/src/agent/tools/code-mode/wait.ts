/**
 * `tools` domain — `IWaitTool` contract (the `wait` Code Mode transport).
 *
 * Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

export const WaitInputSchema = z
  .object({
    cell_id: z.string().describe('Code Mode cell identifier returned by exec.'),
  })
  .strict();

export type WaitInput = z.infer<typeof WaitInputSchema>;

export interface IWaitTool extends AgentTool<WaitInput> {
  readonly _serviceBrand: undefined;
}

export const IWaitTool = createDecorator<IWaitTool>('waitTool');
