/**
 * `team` domain — `TeamFeature`: the Agent Team task-board capability
 * assembled as one App-scope Feature unit.
 *
 * Contributes the per-Session `ISessionTeamBoardService` and the
 * per-Agent `Team` agent tool through the `features` base-class seams;
 * retracting the unit withdraws both across the scope tree. No config
 * surface, no wire vocabulary — the board is in-memory session state.
 * Registered into the feature table at import.
 */

import { LifecycleScope } from '#/app/scopes';
import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import { ISessionTeamBoardService } from './team';
import { SessionTeamBoardService } from './teamService';
import { ITeamTool } from './tools/team/team';
import { TeamTool } from './tools/team/teamTool';

export class TeamFeature extends Feature {
  static override readonly name = 'team';

  constructor() {
    super();
    this.contributeService(LifecycleScope.Session, ISessionTeamBoardService, SessionTeamBoardService);
    this.contributeTool(ITeamTool, TeamTool, { name: 'Team', domain: 'subagent' });
  }
}

registerFeature(TeamFeature);
