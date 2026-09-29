import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { CodeModeRuntime } from '../../../code-mode';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

export const WAIT_TOOL_NAME = 'wait';

export const WaitInputSchema = z
  .object({
    cell_id: z.string().describe('Code Mode cell identifier returned by exec.'),
  })
  .strict();

export type WaitInput = z.infer<typeof WaitInputSchema>;

export class WaitTool implements BuiltinTool<WaitInput> {
  readonly name = WAIT_TOOL_NAME;
  readonly description = 'Resume or poll a yielded Code Mode cell by identifier.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WaitInputSchema);

  constructor(private readonly runtime: CodeModeRuntime) {}

  resolveExecution(args: WaitInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: 'Code Mode wait',
      display: { kind: 'generic', summary: 'Code Mode wait' },
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(args: WaitInput, _ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    const cell = await this.runtime.wait(args.cell_id);
    if (cell.status === 'failed') {
      return { output: cell.error ?? 'wait failed', isError: true };
    }
    return { output: cell.output ?? `cell ${cell.id}: ${cell.status}` };
  }
}
