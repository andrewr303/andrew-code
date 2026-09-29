/**
 * `dap` domain — `IDebugTool` contract.
 *
 * Public contract of the `Debug` tool: one command surface over the
 * named-session debug service — launch/attach, set_breakpoint(s),
 * continue, step_over/step_in/step_out, pause, stack_trace, scopes,
 * variables, evaluate, threads, stop. Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

export const DebugToolInputSchema = z
  .object({
    command: z
      .enum([
        'launch',
        'attach',
        'set_breakpoints',
        'continue',
        'step_over',
        'step_in',
        'step_out',
        'pause',
        'stack_trace',
        'scopes',
        'variables',
        'evaluate',
        'threads',
        'stop',
      ])
      .describe('Debug operation to perform.'),
    session: z
      .string()
      .optional()
      .describe('Named debug session. Defaults to "default". Sessions persist across calls.'),
    program: z.string().optional().describe('Program path for launch.'),
    args: z.array(z.string()).optional().describe('Program arguments for launch.'),
    pid: z.number().int().optional().describe('Process id to attach to.'),
    stop_on_entry: z.boolean().optional().describe('Break immediately after launch.'),
    path: z.string().optional().describe('Source file for breakpoints.'),
    breakpoints: z
      .array(z.number().int())
      .optional()
      .describe('Line numbers for set_breakpoints.'),
    frame: z.number().int().optional().describe('Stack frame id for scopes/variables/evaluate.'),
    variables_reference: z.number().int().optional().describe('Variables handle from scopes.'),
    expression: z.string().optional().describe('Expression to evaluate.'),
  })
  .strict();

export type DebugToolInput = z.infer<typeof DebugToolInputSchema>;

export interface IDebugTool extends AgentTool<DebugToolInput> {
  readonly _serviceBrand: undefined;
}
export const IDebugTool = createDecorator<IDebugTool>('debugTool');
