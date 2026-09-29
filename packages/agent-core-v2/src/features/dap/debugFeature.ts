/**
 * `dap` domain — `DebugFeature`: the real-debugger capability assembled as
 * one App-scope Feature unit.
 *
 * Contributes the per-Agent `IDebugService` and the `Debug` agent tool
 * through the `features` base-class seams; retracting the unit withdraws
 * both across the scope tree (live adapter processes die with the
 * services' own disposal). The `debug-dap` flag
 * (`features/dap/flag`) stays on its static import=register channel.
 * Registered into the feature table at import.
 */

import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import './flag';
import { IDebugService } from './debug';
import { AgentDebugService } from './debugService';
import { IDebugTool } from './tools/debug/debug';
import { DebugTool } from './tools/debug/debugTool';

export class DebugFeature extends Feature {
  static override readonly name = 'dap';

  constructor() {
    super();
    this.contributeAgentService(IDebugService, AgentDebugService);
    this.contributeTool(IDebugTool, DebugTool, { name: 'Debug', domain: 'exec' });
  }
}

registerFeature(DebugFeature);
