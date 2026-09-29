/**
 * `fusion` domain — assembles persistent teams and the legacy sidekick pair.
 *
 * Contributes a Session coordinator, Agent facade and guards, the FusionTeam
 * tool and fusion command through the `features` seams. Keeps the legacy
 * IFusionService/Sidekick pair intact. Config and flag contracts retain their
 * static import registration. Registered as an App-scope Feature unit.
 */

import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';
import { LifecycleScope } from '#/app/scopes';
import { IAgentFusionTeamService, ISessionFusionTeamService } from './fusionTeam';
import { SessionFusionTeamService } from './fusionTeamService';
import { AgentFusionTeamService } from './fusionTeamActorService';
import { IFusionTeamTool, FusionTeamTool } from './tools/fusionTeamTool';

import './configSection';
import './flag';
import { IFusionService } from './fusion';
import { AgentFusionService } from './fusionService';
import { ISidekickTool } from './tools/sidekick/sidekick';
import { SidekickTool } from './tools/sidekick/sidekickTool';

export class FusionFeature extends Feature {
  static override readonly name = 'fusion';

  constructor() {
    super();
    this.contributeService(LifecycleScope.Session, ISessionFusionTeamService, SessionFusionTeamService);
    this.contributeAgentService(IAgentFusionTeamService, AgentFusionTeamService);
    this.contributeTool(IFusionTeamTool, FusionTeamTool, { name: 'FusionTeam', domain: 'subagent' });
    this.contributeCommand({
      name: 'fusion',
      description: 'Persistent Fusion: genius-boss [dual], idiot-boss [dual], on, dual, off, status',
      run: (ctx) => ctx.get(IAgentFusionTeamService).command(ctx.args),
    });
    this.contributeAgentService(IFusionService, AgentFusionService);
    this.contributeTool(ISidekickTool, SidekickTool, { name: 'Sidekick', domain: 'subagent' });
  }
}

registerFeature(FusionFeature);
