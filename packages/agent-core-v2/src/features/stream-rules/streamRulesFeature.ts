/**
 * `stream-rules` domain — `StreamRulesFeature`: the time-traveling stream
 * rules capability assembled as one App-scope Feature unit.
 *
 * Contributes the per-Agent `IStreamRulesService` through the `features`
 * base-class seam; retracting the unit withdraws it across the scope tree.
 * The `streamRules` config section (`features/stream-rules/configSection`),
 * the `stream-rules` flag (`features/stream-rules/flag`), and the
 * `streamRule.*` wire vocabulary (`features/stream-rules/streamRuleOps`)
 * stay on their static import=register channels — user-facing contracts must
 * remain statically discoverable (config manifest) and wire records
 * replayable even when the feature unit is retracted. Registered into the
 * feature table at import.
 */

import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import './configSection';
import './flag';
import './streamRuleOps';
import { IStreamRulesService } from './streamRules';
import { AgentStreamRulesService } from './streamRulesService';

export class StreamRulesFeature extends Feature {
  static override readonly name = 'stream-rules';

  constructor() {
    super();
    this.contributeAgentService(IStreamRulesService, AgentStreamRulesService);
  }
}

registerFeature(StreamRulesFeature);
