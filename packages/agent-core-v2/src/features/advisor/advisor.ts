/**
 * `advisor` domain — `IAdvisorService` contract.
 *
 * A second model watching every turn (oh-my-pi's advisor role): after each
 * completed primary turn the service sends the turn's transcript tail to the
 * configured advisor model with read-only tools and injects any returned
 * notes inline as `<system-reminder>` messages — a quiet aside, a concern,
 * or (severity `blocker`) a turn-stopping interruption. Reviews that find
 * nothing emit nothing, so the main agent pays no context tax on clean
 * turns. The advisor runs on its own model binding (the `[secondary_model]`
 * section when the `secondary-model` flag is on, else the caller's model)
 * with tools restricted to the read-only surface and delegation denied, so
 * it can never act — only observe. State (notes delivered this turn, turns
 * reviewed) is plain instance state reset on `turn.started`; nothing
 * persists to the wire, so advisors never leak across replays. Bound at
 * Agent scope — contributed into every Agent scope by `AdvisorFeature`
 * (`features/advisor/advisorFeature`).
 */

import { createDecorator } from '#/_base/di/instantiation';

export type AdvisorSeverity = 'aside' | 'concern' | 'blocker';

export interface AdvisorNote {
  readonly severity: AdvisorSeverity;
  readonly text: string;
}

export interface IAdvisorService {
  readonly _serviceBrand: undefined;

  /** Whether an advisor review will run (flag + model binding present). */
  enabled(): boolean;

  /** Review the just-finished turn; inject notes and report blockers. */
  reviewTurn(turnId: number): Promise<readonly AdvisorNote[]>;
}

export const IAdvisorService = createDecorator<IAdvisorService>('advisorService');
