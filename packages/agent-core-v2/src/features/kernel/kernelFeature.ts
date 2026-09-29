/**
 * `kernel` domain — `KernelFeature`: the persistent code-execution
 * capability assembled as one App-scope Feature unit.
 *
 * Contributes the per-Agent `IKernelService` and the `Kernel` agent tool
 * through the `features` base-class seams; retracting the unit withdraws
 * both across the scope tree (live children are killed by the services'
 * own disposal). The `kernel` flag (`features/kernel/flag`) stays on its
 * static import=register channel. Registered into the feature table at
 * import.
 */

import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import './flag';
import { IKernelService } from './kernel';
import { AgentKernelService } from './kernelService';
import { IKernelTool } from './tools/kernel/kernel';
import { KernelTool } from './tools/kernel/kernelTool';

export class KernelFeature extends Feature {
  static override readonly name = 'kernel';

  constructor() {
    super();
    this.contributeAgentService(IKernelService, AgentKernelService);
    this.contributeTool(IKernelTool, KernelTool, { name: 'Kernel', domain: 'exec' });
  }
}

registerFeature(KernelFeature);
