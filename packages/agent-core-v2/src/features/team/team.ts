/**
 * `team` domain — `ISessionTeamBoardService` contract.
 *
 * The Agent Team task board (oh-my-openagent's `team-tasklist` +
 * FrontierAgent's `agent_team` board): a session-shared board the lead
 * decomposes work onto, subagents atomically claim tasks from, and every
 * member reports back through with structured reports the parent reads
 * directly. The board is deliberately in-memory Session state — members
 * are Agent scopes in this same process, so a `Map` gives the donor's
 * file-locked board semantics (exclusive claim, owner tracking, live
 * status) without a persistence layer; a session restart drops the board
 * and reports, matching how transient a coordination run is. Reports
 * follow FrontierAgent's schema: finding, evidence, confidence, and the
 * unresolved / disconfirming honesty fields. Bound at Session scope —
 * contributed by `TeamFeature` (`features/team/teamFeature`).
 */

import { createDecorator } from '#/_base/di/instantiation';

export type TeamTaskStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled';

export interface TeamTask {
  readonly id: string;
  readonly description: string;
  readonly status: TeamTaskStatus;
  readonly owner?: string;
  readonly note?: string;
}

export interface TeamReport {
  readonly agentId: string;
  readonly taskIds: readonly string[];
  readonly content: string;
  readonly confidence?: number;
  readonly unresolved?: string;
  readonly disconfirming?: string;
}

export interface ISessionTeamBoardService {
  readonly _serviceBrand: undefined;

  addTask(description: string, options?: { readonly id?: string }): TeamTask;
  updateTask(id: string, patch: { status?: TeamTaskStatus; note?: string }): TeamTask | undefined;
  claimTask(id: string, owner: string): TeamTask | undefined;
  listTasks(): readonly TeamTask[];
  task(id: string): TeamTask | undefined;
  submitReport(report: Omit<TeamReport, 'agentId'> & { agentId?: string }): TeamReport;
  collectReports(): readonly TeamReport[];
  pendingReports(): readonly TeamReport[];
  reset(): void;
}

export const ISessionTeamBoardService = createDecorator<ISessionTeamBoardService>(
  'sessionTeamBoardService',
);
