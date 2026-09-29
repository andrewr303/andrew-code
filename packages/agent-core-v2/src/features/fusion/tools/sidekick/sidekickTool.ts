/**
 * `fusion` domain — `ISidekickTool` implementation.
 *
 * Model-facing wrapper over `IFusionService.handoff`: resolves to an
 * error result when fusion is off, honors the `fresh` flag by resetting
 * the sidekick before the handoff, and renders completed reports /
 * injection notices / failures for the lead. Bound at Agent scope.
 */

import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';

import DESCRIPTION from './sidekick.md?raw';
import { IFusionService } from '../../fusion';
import { ISidekickTool, SidekickToolInputSchema, type SidekickToolInput } from './sidekick';

export class SidekickTool implements ISidekickTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Sidekick' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(SidekickToolInputSchema);

  constructor(@IFusionService private readonly fusion: IFusionService) {}

  resolveExecution(args: SidekickToolInput): ToolExecution {
    return {
      description: 'Handing a brief to the fusion sidekick',
      accesses: [],
      approvalRule: this.name,
      execute: async (ctx) => {
        if (!this.fusion.enabled()) {
          return {
            isError: true,
            output:
              'Fusion is not enabled. Enable it via the [fusion] config section (enabled = true) and the KIMI_CODE_EXPERIMENTAL_FUSION flag.',
          };
        }
        if (args.fresh === true) await this.fusion.resetSidekick();
        const handoff = await this.fusion.handoff(args.brief, { signal: ctx.signal });
        if (handoff.status === 'failed') {
          return { isError: true, output: `Sidekick handoff failed: ${handoff.report}` };
        }
        if (handoff.status === 'injected') {
          return { output: handoff.report };
        }
        return { output: handoff.report.length === 0 ? '(sidekick returned no report)' : handoff.report };
      },
    };
  }
}
