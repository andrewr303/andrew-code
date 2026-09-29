import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import type { CodeModeRuntime } from '../../../code-mode';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

export const EXEC_TOOL_NAME = 'exec';

export const ExecInputSchema = z
  .object({
    source: z.string().describe('JavaScript source to run in the persistent Code Mode runtime.'),
  })
  .strict();

export type ExecInput = z.infer<typeof ExecInputSchema>;

export class ExecTool implements BuiltinTool<ExecInput> {
  readonly name = EXEC_TOOL_NAME;
  readonly description =
    'Run JavaScript in the persistent Code Mode runtime. Ordinary tools are available as tools.name(args). Direct-only collaboration tools stay top-level.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ExecInputSchema);
  readonly wire = 'custom' as const;

  constructor(private readonly runtime: CodeModeRuntime) {}

  resolveExecution(args: ExecInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      description: 'Code Mode exec',
      display: { kind: 'generic', summary: 'Code Mode exec' },
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(args: ExecInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    const cell = await this.runtime.exec(args.source, { signal: ctx.signal });
    if (cell.status === 'failed') {
      return { output: cell.error ?? 'exec failed', isError: true };
    }
    return { output: cell.output ?? '' };
  }
}
