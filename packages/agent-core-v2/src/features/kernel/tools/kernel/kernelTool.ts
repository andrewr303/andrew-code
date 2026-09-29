/**
 * `kernel` domain — `IKernelTool` implementation.
 *
 * Thin model-facing wrapper over `kernel`: reset mode kills sessions,
 * otherwise the cell runs in the named persistent session and the captured
 * output (or the reported error) returns as the tool result. Bound at
 * Agent scope.
 */

import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ToolAccesses } from '#/tool/toolContract';

import DESCRIPTION from './kernel.md?raw';
import { IKernelService } from '../../kernel';
import { IKernelTool, KernelToolInputSchema, type KernelToolInput } from './kernel';

export class KernelTool implements IKernelTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Kernel' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(KernelToolInputSchema);

  constructor(@IKernelService private readonly kernel: IKernelService) {}

  resolveExecution(args: KernelToolInput): ToolExecution {
    return {
      description:
        args.reset === true
          ? 'Resetting kernel sessions'
          : `Running ${args.language} cell${args.session !== undefined ? ` in session "${args.session}"` : ''}`,
      accesses: ToolAccesses.all(),
      approvalRule: this.name,
      execute: async (ctx) => {
        if (args.reset === true) {
          await this.kernel.reset(args.session);
          return { output: 'Kernel sessions reset.' };
        }
        const result = await Promise.race([
          this.kernel.run(args.language, args.code, args.session),
          cancelAsError(ctx.signal),
        ]);
        if (result.status === 'error') return { output: result.output, isError: true };
        return { output: result.output.length === 0 ? '(no output)' : result.output };
      },
    };
  }
}

async function cancelAsError(signal: AbortSignal): Promise<never> {
  if (signal.aborted) throw signal.reason;
  await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
  throw signal.reason;
}
