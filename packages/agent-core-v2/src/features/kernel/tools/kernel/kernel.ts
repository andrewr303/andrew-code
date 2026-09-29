/**
 * `kernel` domain — `IKernelTool` contract.
 *
 * Public contract of the `Kernel` tool: run a code cell in a named
 * persistent session (`python` keeps globals across calls in a long-lived
 * `python3` child; `javascript` runs in the persistent Code Mode runtime),
 * or reset sessions. Python cells can call back into `agent.read` /
 * `agent.glob` / `agent.grep`. Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

export const KernelToolInputSchema = z
  .object({
    language: z.enum(['python', 'javascript']).describe('Cell language.'),
    code: z.string().describe('Source to execute in the persistent session.'),
    session: z
      .string()
      .optional()
      .describe('Named session holding persistent state across calls. Defaults to one session per language.'),
    reset: z
      .boolean()
      .optional()
      .describe('When true, kill the named session (or all sessions) instead of running code.'),
  })
  .strict();

export type KernelToolInput = z.infer<typeof KernelToolInputSchema>;

export interface IKernelTool extends AgentTool<KernelToolInput> {
  readonly _serviceBrand: undefined;
}
export const IKernelTool = createDecorator<IKernelTool>('kernelTool');
