/**
 * `yield` domain — `YieldFeature`: the structured subagent yield capability
 * assembled as one App-scope Feature unit.
 *
 * Contributes the per-Session `ISessionYieldService` and the per-Agent
 * `Yield` tool through the `features` base-class seams; retracting the unit
 * withdraws both across the scope tree. No config surface, no wire
 * vocabulary — payloads are transient turn-scoped handoffs. Registered
 * into the feature table at import.
 */

import { LifecycleScope } from '#/app/scopes';
import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { ISessionYieldService } from './yield';
import { SessionYieldService } from './yieldService';
import { IYieldTool } from './tools/yield/yield';
import { YieldTool } from './tools/yield/yieldTool';

export class YieldFeature extends Feature {
  static override readonly name = 'yield';

  constructor() {
    super();
    this.contributeService(LifecycleScope.Session, ISessionYieldService, SessionYieldService);
    this.contributeTool(IYieldTool, YieldTool, { name: 'Yield', domain: 'subagent' });
  }
}

registerFeature(YieldFeature);
