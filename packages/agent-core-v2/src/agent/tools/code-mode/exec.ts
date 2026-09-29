/**
 * `tools` domain — `IExecTool` contract (the `exec` Code Mode transport).
 *
 * Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

export const ExecInputSchema = z
  .object({
    source: z.string().describe('JavaScript source to run in the persistent Code Mode runtime.'),
  })
  .strict();

export type ExecInput = z.infer<typeof ExecInputSchema>;

export interface IExecTool extends AgentTool<ExecInput> {
  readonly _serviceBrand: undefined;
  readonly wire: 'custom';
}

export const IExecTool = createDecorator<IExecTool>('execTool');
