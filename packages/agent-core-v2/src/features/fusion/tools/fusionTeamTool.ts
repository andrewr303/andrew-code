/**
 * `fusion` domain — model-facing attributed team coordination tool.
 *
 * Delegates to the Agent facade so a model cannot spoof its sender identity.
 * Bound at Agent scope by FusionFeature; ordinary tool permissions still apply.
 */
import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool, ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { IAgentFusionTeamService, FusionTeamInputSchema, type FusionTeamInput } from '../fusionTeam';

export interface IFusionTeamTool extends AgentTool<FusionTeamInput> {
  readonly _serviceBrand: undefined;
}
export const IFusionTeamTool = createDecorator<IFusionTeamTool>('fusionTeamTool');
export class FusionTeamTool implements IFusionTeamTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'FusionTeam';
  readonly description = 'Coordinate the persistent Fusion team. Use status for strategy, actual IDs/models and verification receipts; handoff for bounded briefs; inbox/ack for durable mail. CEO/COO may spawn and route idle workers in genius-boss. The idiot-boss coordinator hands coherent implementation to Astra, independently verifies, then uses finish with observed verification tool-call IDs. At most THREE Astra implementation handoffs per real user task including running-target injections/queues. In idiot-boss, message/broadcast queue informational data for every recipient without injecting or starting a run or changing the budget; recipients read inbox. Mail is not a new implementation brief and cannot authorize more work beyond the cap. A completed run is unverified, not acceptance. needs-user means stop, not success. Consult CEO on demand, never automatically panel both frontier models each iteration. No automatic retries or hidden provider substitutions.';
  readonly parameters = toInputJsonSchema(FusionTeamInputSchema);
  constructor(@IAgentFusionTeamService private readonly actor: IAgentFusionTeamService) {}
  resolveExecution(input: FusionTeamInput): ToolExecution {
    return {
      description: `Fusion team: ${input.action}`,
      accesses: [],
      approvalRule: this.name,
      execute: async ({ signal, toolCallId }) => {
        try {
          const result = await this.actor.execute(input, signal, toolCallId);
          const status = typeof result === 'object' && result !== null && 'status' in result ? result.status : undefined;
          const failed = status === 'failed' || status === 'cancelled' || status === 'needs-user';
          return { output: JSON.stringify(result), isError: failed, stopTurn: status === 'needs-user' };
        } catch (error) {
          if (signal.aborted) throw error;
          return { isError: true, output: error instanceof Error ? error.message : String(error) };
        }
      },
    };
  }
}
