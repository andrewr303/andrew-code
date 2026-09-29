/**
 * `fusion` domain — `IFusionService` contract.
 *
 * Local Fusion (Devin's architecture, ported onto this engine's
 * lead/sidekick seams): the lead agent runs the frontier model and owns
 * the plan, ambiguity, and review; a persistent sidekick subagent runs the
 * cost-efficient model and executes handoffs. Handoffs exchange briefs,
 * not histories — each agent keeps its own persistent, cache-friendly
 * context (the sidekick resumes the same agent across handoffs). A new
 * brief arriving while the sidekick is mid-handoff is injected into its
 * running loop as an interrupt instead of queueing. Compaction boundaries
 * re-evaluate which of the two models should be in charge (the cache miss
 * happens there anyway, so the switch is free). Bound at Agent scope —
 * contributed into every Agent scope by `FusionFeature`
 * (`features/fusion/fusionFeature`).
 */

import { createDecorator } from '#/_base/di/instantiation';

export interface HandoffResult {
  readonly status: 'completed' | 'injected' | 'failed';
  readonly report: string;
}

export interface IFusionService {
  readonly _serviceBrand: undefined;

  /** Fusion enabled (flag on and configured pairing resolvable). */
  enabled(): boolean;

  /** The configured pairing, resolved through the model catalog. */
  pairing(): { leadModel: string; sidekickModel: string } | undefined;

  /**
   * Hand a brief to the persistent sidekick: resume-or-spawn, run to
   * completion, and return its report. A brief arriving while the sidekick
   * is still running is injected into the running handoff as an interrupt
   * and reported as `injected`.
   */
  handoff(brief: string, options?: { readonly signal?: AbortSignal }): Promise<HandoffResult>;

  /** Drop the sidekick agent so the next handoff starts fresh. */
  resetSidekick(): Promise<void>;
}

export const IFusionService = createDecorator<IFusionService>('fusionService');
