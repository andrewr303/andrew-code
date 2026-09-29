/**
 * `advisor` domain — `AdvisorFeature`: the second-model reviewer capability
 * assembled as one App-scope Feature unit.
 *
 * Contributes the per-Agent `IAdvisorService` through the `features`
 * base-class seam; retracting the unit withdraws it across the scope tree.
 * The model binding reuses the existing `[secondary_model]` section and the
 * `secondary-model` flag — no new config surface. Registered into the
 * feature table at import.
 */

import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { IAdvisorService } from './advisor';
import { AgentAdvisorService } from './advisorService';

export class AdvisorFeature extends Feature {
  static override readonly name = 'advisor';

  constructor() {
    super();
    this.contributeAgentService(IAdvisorService, AgentAdvisorService);
  }
}

registerFeature(AdvisorFeature);
