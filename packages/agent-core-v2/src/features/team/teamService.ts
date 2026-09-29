/**
 * `team` domain — `ISessionTeamBoardService` implementation.
 *
 * In-memory board: sequential `t1, t2, …` ids, status transitions
 * (`open → in_progress → resolved/cancelled`), exclusive `claimTask`
 * (a claim on an owned or non-open task fails), and an append-only report
 * list `collectReports` drains exactly once. No persistence — the board
 * and uncollected reports live and die with the session process.
 * Session scope — contributed by `TeamFeature`
 * (`features/team/teamFeature`).
 */

import { Service } from '#/_base/di/service';

import {
  ISessionTeamBoardService,
  type TeamReport,
  type TeamTask,
  type TeamTaskStatus,
} from './team';

export class SessionTeamBoardService extends Service implements ISessionTeamBoardService {
  declare readonly _serviceBrand: undefined;

  private readonly tasks = new Map<string, TeamTask>();
  private reports: TeamReport[] = [];
  private nextTask = 1;

  addTask(description: string, options: { readonly id?: string } = {}): TeamTask {
    const id = options.id ?? `t${String(this.nextTask++)}`;
    const task: TeamTask = { id, description, status: 'open' };
    this.tasks.set(id, task);
    return task;
  }

  updateTask(
    id: string,
    patch: { status?: TeamTaskStatus; note?: string },
  ): TeamTask | undefined {
    const current = this.tasks.get(id);
    if (current === undefined) return undefined;
    const next: TeamTask = {
      id,
      description: current.description,
      status: patch.status ?? current.status,
      owner: current.owner,
      note: patch.note ?? current.note,
    };
    this.tasks.set(id, next);
    return next;
  }

  claimTask(id: string, owner: string): TeamTask | undefined {
    const current = this.tasks.get(id);
    if (current === undefined || current.status !== 'open') return undefined;
    const next: TeamTask = { ...current, owner, status: 'in_progress' };
    this.tasks.set(id, next);
    return next;
  }

  listTasks(): readonly TeamTask[] {
    return [...this.tasks.values()];
  }

  task(id: string): TeamTask | undefined {
    return this.tasks.get(id);
  }

  submitReport(report: Omit<TeamReport, 'agentId'> & { agentId?: string }): TeamReport {
    const full: TeamReport = { ...report, agentId: report.agentId ?? 'unknown' };
    this.reports.push(full);
    for (const taskId of report.taskIds) this.updateTask(taskId, { status: 'resolved' });
    return full;
  }

  collectReports(): readonly TeamReport[] {
    const drained = this.reports;
    this.reports = [];
    return drained;
  }

  pendingReports(): readonly TeamReport[] {
    return [...this.reports];
  }

  reset(): void {
    this.tasks.clear();
    this.reports = [];
    this.nextTask = 1;
  }
}
