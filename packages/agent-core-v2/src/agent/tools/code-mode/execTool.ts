/**
 * `tools` domain — `ExecTool` implementation (the `exec` tool).
 */

import { toInputJsonSchema } from '#/tool/input-schema';
import {
  ToolAccesses,
  type ExecutableToolContext,
  type ExecutableToolResult,
  type ToolExecution,
} from '#/tool/toolContract';
import { registerAgentToolService } from '#/agent/toolRegistry/toolContribution';
import { ICodeModeService } from '#/agent/codeMode/codeMode';

import { IExecTool, ExecInputSchema, type ExecInput } from './exec';
import DESCRIPTION from './exec.md?raw';

export class ExecTool implements IExecTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'exec' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(ExecInputSchema);
  readonly wire = 'custom' as const;

  constructor(@ICodeModeService private readonly codeMode: ICodeModeService) {}

  resolveExecution(args: ExecInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      description: 'Code Mode exec',
      display: { kind: 'generic', summary: 'Code Mode exec' },
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: ExecInput,
    ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    const cell = await this.codeMode.exec(args.source, { signal: ctx.signal });
    if (cell.status === 'failed') {
      return { output: cell.error ?? 'exec failed', isError: true };
    }
    return { output: cell.output ?? '' };
  }
}

registerAgentToolService(IExecTool, ExecTool, { name: 'exec', domain: 'codeMode' });
