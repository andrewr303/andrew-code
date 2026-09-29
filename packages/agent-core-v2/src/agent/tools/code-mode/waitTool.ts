/**
 * `tools` domain — `WaitTool` implementation (the `wait` tool).
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

import { IWaitTool, WaitInputSchema, type WaitInput } from './wait';
import DESCRIPTION from './wait.md?raw';

export class WaitTool implements IWaitTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'wait' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WaitInputSchema);

  constructor(@ICodeModeService private readonly codeMode: ICodeModeService) {}

  resolveExecution(args: WaitInput): ToolExecution {
    return {
      accesses: ToolAccesses.none(),
      description: 'Code Mode wait',
      display: { kind: 'generic', summary: 'Code Mode wait' },
      approvalRule: this.name,
      execute: () => this.execution(args),
    };
  }

  private async execution(args: WaitInput): Promise<ExecutableToolResult> {
    const cell = await this.codeMode.wait(args.cell_id);
    if (cell.status === 'failed') {
      return { output: cell.error ?? 'wait failed', isError: true };
    }
    return { output: cell.output ?? `cell ${cell.id}: ${cell.status}` };
  }
}

registerAgentToolService(IWaitTool, WaitTool, { name: 'wait', domain: 'codeMode' });
