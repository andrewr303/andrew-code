/**
 * `fusion` domain — Session-owned durable team coordination.
 *
 * Persists membership and attributed per-recipient mail through `persistence`,
 * resolves models through `kosong/model` and configuration through `config`,
 * restores native histories through `agentLifecycle`, and drives existing
 * `subagent` runs with inherited `permissionMode`, `userTool` and `plan`
 * restrictions. Uses `prompt` for live delivery and the official Claude
 * transport for an external, tool-less CEO. Bound at Session scope.
 */
import { randomUUID } from 'node:crypto';
import { Service } from '#/_base/di/service';
import type { IAgentScopeHandle } from '#/_base/di/scope';
import { IAgentLoopService } from '#/agent/loop/loop';
import { isDisplayablePromptOrigin, type TurnStartedEvent } from '#/agent/loop/turnEvents';
import type { ToolDidExecuteContext } from '#/agent/toolExecutor/toolHooks';
import { emitAgentRunSpawned, mirrorAgentRun } from '#/session/subagent/mirrorAgentRun';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import { IAgentPermissionRulesService } from '#/agent/permissionRules/permissionRules';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentPromptService } from '#/agent/prompt/prompt';
import { IAgentUserToolService } from '#/agent/userTool/userTool';
import { DEFAULT_PROFILE_NAME } from '#/agent/tools/agent/agent';
import { IConfigService } from '#/app/config/config';
import { IFlagService } from '#/app/flag/flag';
import { IAgentPlanService } from '#/features/plan/plan';
import { IModelCatalog } from '#/kosong/model/catalog';
import { IAtomicDocumentStore } from '#/persistence/interface/atomicDocumentStore';
import { IAgentLifecycleService } from '#/session/agentLifecycle/agentLifecycle';
import { subagentLabels } from '#/session/agentLifecycle/subagentMetadata';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionSubagentService } from '#/session/subagent/subagent';
import type { TokenUsage } from '#/kosong/contract/usage';
import { addUsage, emptyUsage } from '#/kosong/contract/usage';
import { DEFAULT_FUSION_CONFIG, FUSION_SECTION, type FusionConfig } from './configSection';
import { FUSION_FLAG_ID } from './flag';
import {
  ISessionFusionTeamService, FusionTeamInputSchema, MAIL_LIMIT, PACKET_LIMIT, fusionError, roleGuidance,
  type FusionHandoff, type FusionMail, type FusionMember, type FusionRole,
  type FusionTeamInput, type FusionTeamState, type FusionTeamStatus,
} from './fusionTeam';
import { FusionModelMissingError, resolveFusionModel } from './modelPolicy';
import { hasClaudeApiKeyCredential, readClaudeSubscriptionAuth, resolveClaudeExecutable, runClaudeDecision, type ClaudeSubscriptionAuth } from './claudeTransport';

const STATE_KEY = 'team.json';
const ORIGIN = { kind: 'system_trigger', name: 'fusion-team' } as const;
const COMMAND_SYNTAX = 'expected on, dual, off, status, genius-boss [dual] or idiot-boss [dual], followed only by ceo=<alias>[@effort], coo=<alias>[@effort], worker=<alias>[@effort], muse=<alias>[@effort]. Example: genius-boss dual ceo=my-astra@xhigh coo=my-opus@xhigh worker=my-flash muse=my-muse@max. off/status accept no trailing tokens.';
type OverrideRole = 'ceo' | 'coo' | 'worker' | 'muse';
type RoleOverrides = Partial<Record<OverrideRole, { model: string; effort?: string }>>;

function parseCommand(raw: string): { command: string; dual: boolean; overrides: RoleOverrides } {
  const [command = '', ...tokens] = raw.trim().split(/\s+/);
  if (!['on', 'dual', 'off', 'status', 'genius-boss', 'idiot-boss'].includes(command)) throw fusionError(COMMAND_SYNTAX);
  if ((command === 'off' || command === 'status') && tokens.length > 0) throw fusionError(COMMAND_SYNTAX);
  let dual = command === 'dual';
  if (tokens[0] === 'dual') { dual = true; tokens.shift(); }
  const overrides: RoleOverrides = {};
  for (const token of tokens) {
    const match = /^(ceo|coo|worker|muse)=([^\s@]+)(?:@([^\s@]+))?$/.exec(token);
    if (match === null) throw fusionError(COMMAND_SYNTAX);
    const role = match[1] as OverrideRole;
    if (overrides[role] !== undefined) throw fusionError(`duplicate ${role} override; ${COMMAND_SYNTAX}`);
    overrides[role] = { model: match[2]!, effort: match[3] };
  }
  return { command, dual, overrides };
}

function formatClaudeSubscriptionStatus(auth: ClaudeSubscriptionAuth): string {
  if (auth.authenticated) {
    let details = '';
    if (auth.subscriptionType && auth.rateLimitTier) {
      details = ` as ${auth.subscriptionType} (${auth.rateLimitTier})`;
    } else if (auth.subscriptionType) {
      details = ` as ${auth.subscriptionType}`;
    } else if (auth.rateLimitTier) {
      details = ` (${auth.rateLimitTier})`;
    }
    const expiredNote = auth.expired
      ? ' (access token expired; the CLI will refresh it — re-run `andrewcode login claude` if that fails.)'
      : '';
    return `Claude Code subscription: authenticated${details}${expiredNote}.`;
  }
  if (auth.fileState === 'unreadable') {
    return 'Claude Code credentials file exists but could not be read (corrupt or unreadable); run `andrewcode login claude` to rewrite it.';
  }
  if (!auth.fileFound || auth.fileState === 'missing') {
    return 'Claude Code subscription: credentials file not found — install Claude Code and run `andrewcode login claude`.';
  }
  return 'Claude Code subscription: not authenticated — run `andrewcode login claude`.';
}

function roleResolutionError(role: OverrideRole, error: unknown, extra?: string) {
  const detail = error instanceof Error ? error.message.replace(/^Fusion: /, '') : String(error);
  const remedy = role === 'ceo'
    ? 'Fix: set [fusion] ceo_model (or pass ceo=<alias>) to a configured alias — run /model to list yours — or install the official Claude Code CLI on PATH and run andrewcode login claude for the tool-less CEO fallback. CLI fallback requires the default CEO alias without a ceo override.'
    : `Fix: set [fusion] ${role}_model (or pass ${role}=<alias>) to a configured model — run /model to list configured aliases.`;
  const fullRemedy = extra !== undefined ? `${remedy} ${extra}` : remedy;
  return fusionError(`${detail} ${fullRemedy}`);
}

export class SessionFusionTeamService extends Service implements ISessionFusionTeamService {
  declare readonly _serviceBrand: undefined;
  private team: FusionTeamState | undefined;
  private loaded: Promise<void> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly active = new Set<string>();
  private readonly waiting = new Map<string, Set<string>>();
  private readonly readOnly = new Set<string>();
  private readonly parents = new Map<string, string>();
  private readonly shutdown = new AbortController();

  constructor(
    @IAtomicDocumentStore private readonly store: IAtomicDocumentStore,
    @ISessionContext private readonly session: ISessionContext,
    @IConfigService private readonly configService: IConfigService,
    @IFlagService private readonly flags: IFlagService,
    @IModelCatalog private readonly catalog: IModelCatalog,
    @IAgentLifecycleService private readonly lifecycle: IAgentLifecycleService,
    @ISessionSubagentService private readonly subagents: ISessionSubagentService,
  ) {
    super();
    this._register({ dispose: () => this.shutdown.abort(new DOMException('Fusion team disposed', 'AbortError')) });
  }

  private preferences(): Required<Omit<FusionConfig, 'scriptsRoot'>> {
    return { ...DEFAULT_FUSION_CONFIG, ...this.configService.get<FusionConfig | undefined>(FUSION_SECTION) };
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const saved = await this.store.get<FusionTeamState>(this.session.scope('fusion'), STATE_KEY);
      if (saved !== undefined && saved.version !== 1) throw fusionError('unsupported persisted team version.');
      this.team = saved;
      if (saved !== undefined && saved.strategy === undefined) {
        saved.strategy = 'genius-boss';
        await this.save();
      }
      if (saved !== undefined && saved.running.length > 0) {
        for (const id of saved.running) {
          const member = saved.members.find((entry) => entry.id === id);
          if (member !== undefined) member.lastOutcome = 'interrupted';
        }
        saved.running = [];
        await this.save();
      }
    })();
    return this.loaded;
  }

  private async save(): Promise<void> {
    if (this.team !== undefined) await this.store.set(this.session.scope('fusion'), STATE_KEY, this.team);
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => { await this.load(); return work(); });
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async status(): Promise<FusionTeamStatus> {
    await this.load();
    const state = this.team;
    const result: FusionTeamStatus = { enabled: state?.enabled === true && this.flags.enabled(FUSION_FLAG_ID) };
    if (state === undefined) return result;
    const compact = (text: string): string => {
      if (text.length <= 160) return text;
      result.truncated = true;
      return `${text.slice(0, 159)}…`;
    };
    const members = state.members.slice(0, 12).map((member): FusionMember => {
      const profile = this.lifecycle.get(member.id)?.accessor.get(IAgentProfileService);
      const actualModel = profile?.getModel();
      const actualEffort = profile?.getEffectiveThinkingLevel();
      return {
        id: compact(member.id), name: compact(member.name), role: member.role,
        model: compact(member.model), effort: compact(member.effort), transport: member.transport,
        actualModel: actualModel === undefined ? undefined : compact(actualModel),
        actualEffort: actualEffort === undefined ? undefined : compact(actualEffort),
        runs: member.runs, failures: member.failures, cancellations: member.cancellations,
        lastOutcome: member.lastOutcome, failureKind: member.failureKind, readOnly: member.readOnly,
        usage: member.usage === undefined ? undefined : { ...member.usage },
      };
    });
    const hasClaude = state.members.some((member) => member.transport === 'claude');
    let claudeSubscription: 'authenticated' | 'unauthenticated' | 'unavailable' | undefined;
    let claudeSubscriptionExpired: true | undefined;
    if (hasClaude) {
      const executable = resolveClaudeExecutable(this.session.cwd);
      if (executable === undefined) {
        claudeSubscription = 'unavailable';
      } else {
        const auth = readClaudeSubscriptionAuth();
        if (auth.authenticated) {
          claudeSubscription = 'authenticated';
          if (auth.expired) {
            claudeSubscriptionExpired = true;
          }
        } else if (auth.fileFound && auth.fileState !== 'unreadable') {
          claudeSubscription = 'unauthenticated';
        } else {
          claudeSubscription = 'unavailable';
        }
      }
    }
    result.team = {
      enabled: state.enabled, ownerId: compact(state.ownerId), strategy: state.strategy,
      dual: state.dual, hasOriginalBinding: state.originalBinding !== undefined,
      claudeSubscription,
      claudeSubscriptionExpired,
      members,
      mail: state.members.slice(0, 12).map((member) => ({ to: compact(member.id), count: state.mail.filter((mail) => mail.to === member.id).length })),
      routing: state.routing.slice(-3).map((route) => ({ memberId: compact(route.memberId), from: route.from === undefined ? undefined : compact(route.from), to: compact(route.to), reason: compact(route.reason), at: route.at })),
      running: state.running.slice(0, 12).map(compact),
      task: state.task === undefined ? undefined : {
        turnId: state.task.turnId, handoffs: state.task.handoffs, validated: state.task.validated,
        evidence: state.task.evidence.slice(-20).map((entry) => ({ toolCallId: compact(entry.toolCallId), tool: compact(entry.tool) })),
      },
    };
    if (state.members.length > 12 || state.routing.length > 3 || (state.task?.evidence.length ?? 0) > 20) result.truncated = true;
    while (Buffer.byteLength(JSON.stringify(result), 'utf8') > PACKET_LIMIT) {
      result.truncated = true;
      if (result.team.routing.length > 0) result.team.routing.shift();
      else if ((result.team.task?.evidence.length ?? 0) > 0) result.team.task!.evidence.shift();
      else if (result.team.members.length > 0) result.team.members.pop();
      else if (result.team.mail.length > 0) result.team.mail.pop();
      else result.team.running.pop();
    }
    return result;
  }

  async member(agentId: string): Promise<FusionMember | undefined> {
    await this.load();
    if (!this.flags.enabled(FUSION_FLAG_ID) || !this.team?.enabled) return undefined;
    const member = this.team.members.find((entry) => entry.id === agentId);
    return member === undefined ? undefined : structuredClone(member);
  }

  async restricted(agentId: string, inheritedOnly = false): Promise<boolean> {
    const member = await this.member(agentId);
    if (member?.role === 'consultant' || member?.readOnly === true || this.readOnly.has(agentId)) return true;
    const visited = new Set<string>();
    let current: string | undefined = inheritedOnly ? this.parents.get(agentId) : agentId;
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      const scope = this.lifecycle.get(current);
      if (scope !== undefined && await scope.accessor.get(IAgentPlanService).status() !== null) return true;
      current = this.parents.get(current);
    }
    return false;
  }

  async beginTask(actorId: string, event: TurnStartedEvent): Promise<void> {
    await this.serial(async () => {
      const team = this.team;
      if (!team?.enabled || team.strategy !== 'idiot-boss' || actorId !== team.ownerId || !isDisplayablePromptOrigin(event.origin)) return;
      if (team.task?.turnId === event.turnId) return;
      team.task = { turnId: event.turnId, handoffs: 0, evidence: [] };
      await this.save();
    });
  }

  async recordEvidence(actorId: string, event: ToolDidExecuteContext): Promise<void> {
    await this.serial(async () => {
      const team = this.team;
      if (!team?.enabled || team.strategy !== 'idiot-boss' || actorId !== team.ownerId || !team.task || team.task.turnId !== event.turnId) return;
      if (this.active.size > 0 || team.task.handoffs === 0 || event.outcome !== 'executed' || event.result.isError) return;
      const name = event.toolCall.name;
      if (!['Bash', 'Read', 'ReadMediaFile', 'Grep', 'TaskOutput'].includes(name) && !name.startsWith('mcp__')) return;
      const output = JSON.stringify(event.result.output);
      if (!output || output === '""') return;
      team.task.evidence.push({ toolCallId: event.toolCall.id, tool: name, result: output.slice(0, 2000) });
      team.task.evidence = team.task.evidence.slice(-20);
      await this.save();
    });
  }

  async command(actorId: string, command: string): Promise<FusionTeamStatus> {
    await this.serial(async () => {
      const parsed = parseCommand(command);
      command = parsed.command;
      const { dual, overrides } = parsed;
      if (command === 'status' || command === 'off' && !this.team?.enabled) return;
      if (this.team !== undefined && actorId !== this.team.ownerId) throw fusionError('only the session owner may enable or disable the team.');
      const strategy = command === 'idiot-boss' ? 'idiot-boss' : 'genius-boss';
      const prefs = this.preferences();
      for (const role of ['ceo', 'coo', 'worker', 'muse'] as const) {
        const override = overrides[role];
        if (override === undefined) continue;
        prefs[`${role}Model`] = override.model;
        const configuredEffort = role === 'worker' && strategy === 'idiot-boss' ? prefs.coordinatorEffort : prefs[`${role}Effort`];
        prefs[`${role}Effort`] = override.effort ?? configuredEffort;
      }
      if (command !== 'off') {
        if (!this.flags.enabled(FUSION_FLAG_ID)) throw fusionError('experimental flag is disabled. Enable KIMI_CODE_EXPERIMENTAL_FUSION first.');
        if (this.team !== undefined && this.team.strategy !== strategy) throw fusionError('strategy is fixed for this team; start a new session to change strategy.');
        if (overrides.muse !== undefined && !dual && !this.team?.dual) throw fusionError('muse=<alias> requires the dual consultant. Example: on dual muse=my-muse@max.');
        if (this.team !== undefined) {
          for (const role of ['ceo', 'coo', 'worker', 'muse'] as const) {
            if (overrides[role] === undefined) continue;
            const model = await this.resolveRoleModel(role, prefs[`${role}Model`], prefs[`${role}Effort`]);
            const name = role === 'muse' ? 'consultant' : role === 'worker' && strategy === 'idiot-boss' ? 'coordinator' : role;
            const member = this.team.members.find((entry) => entry.name === name);
            if (member?.model !== model.id || member.effort !== prefs[`${role}Effort`]) throw fusionError("Fusion roles are fixed for this team's lifetime; start a new session to change models or efforts.");
          }
        }
        if (this.team?.enabled && (!dual || this.team.dual)) {
          for (const member of this.team.members) this.applyMemberTools(member);
          return;
        }
      }
      if (this.busy() || this.isRunning(actorId)) throw fusionError('the team is busy; wait for active turns before changing its mode.');
      const owner = this.lifecycle.get(actorId);
      if (owner === undefined) throw fusionError('session owner is not registered.');
      if (command === 'off') {
        const boundary = owner.accessor.get(IAgentLoopService).tryAcquireQuiescence();
        if (boundary === undefined) throw fusionError('session owner must be idle before disabling the team.');
        try {
          if (this.team!.originalBinding !== undefined) owner.accessor.get(IAgentProfileService).applyBindingSnapshot(this.team!.originalBinding);
          this.team!.enabled = false;
          await this.save();
        } finally { boundary.dispose(); }
        return;
      }
      if (this.team !== undefined) {
        if (dual && !this.team.members.some((entry) => entry.role === 'consultant')) {
          const model = await this.resolveRoleModel('muse', prefs.museModel, prefs.museEffort);
          const consultant = this.makeMember('consultant', 'consultant', model.id, prefs.museEffort);
          this.team.members.push(consultant);
          await this.materialize(consultant);
        }
        this.team.dual = dual || this.team.dual;
        for (const member of this.team.members) await this.materialize(member);
        await this.bindOwner();
        this.team.enabled = true;
        await this.save();
        return;
      }
      const cooModel = await this.resolveRoleModel('coo', prefs.cooModel, prefs.cooEffort);
      const worker = await this.chooseWorker('worker', overrides.worker, strategy === 'idiot-boss');
      let ceo: FusionMember;
      try {
        const model = await resolveFusionModel(this.catalog, prefs.ceoModel, prefs.ceoEffort);
        ceo = this.makeMember('ceo', 'ceo', model.id, prefs.ceoEffort, strategy === 'genius-boss' ? actorId : undefined);
      } catch (error) {
        if (!(error instanceof FusionModelMissingError) || overrides.ceo !== undefined || prefs.ceoModel !== DEFAULT_FUSION_CONFIG.ceoModel) {
          throw roleResolutionError('ceo', error);
        }
        const executable = resolveClaudeExecutable(this.session.cwd);
        const auth = readClaudeSubscriptionAuth();
        if (executable === undefined) {
          throw roleResolutionError('ceo', error, formatClaudeSubscriptionStatus(auth));
        }
        if (!auth.authenticated && !hasClaudeApiKeyCredential()) {
          throw roleResolutionError('ceo', error, 'Claude Code CLI is installed but its subscription is not authenticated; run `andrewcode login claude`.');
        }
        ceo = { ...this.makeMember('ceo', 'ceo', prefs.claudeModel, 'CLI default (tool-less)'), transport: 'claude', sessionId: randomUUID() };
      }
      const coo = this.makeMember('coo', 'coo', cooModel.id, prefs.cooEffort, strategy === 'genius-boss' && ceo.transport === 'claude' ? actorId : undefined);
      if (strategy === 'idiot-boss') {
        worker.member = { ...worker.member, id: actorId, name: 'coordinator', role: 'coordinator' };
        worker.route.memberId = actorId;
      }
      const members = [ceo, coo, worker.member];
      if (dual) {
        const model = await this.resolveRoleModel('muse', prefs.museModel, prefs.museEffort);
        members.push(this.makeMember('consultant', 'consultant', model.id, prefs.museEffort));
      }
      const routing = [worker.route];
      for (const role of ['ceo', 'coo', 'muse'] as const) {
        const override = overrides[role];
        if (override === undefined) continue;
        const member = members.find((entry) => entry.role === (role === 'muse' ? 'consultant' : role))!;
        routing.push({ memberId: member.id, to: member.model, reason: `Override: ${override.model}`, at: Date.now() });
      }
      const originalBinding = structuredClone(owner.accessor.get(IAgentProfileService).data());
      this.team = { version: 1, enabled: false, ownerId: actorId, strategy, originalBinding, dual, members, mail: [], nextMail: 1, routing, running: [] };
      await this.save();
      for (const member of members) await this.materialize(member);
      await this.bindOwner();
      this.team.enabled = true;
      await this.save();
    });
    return this.status();
  }

  private busy(): boolean {
    return this.active.size > 0 || this.team?.members.some((member) => this.isRunning(member.id)) === true;
  }

  private isRunning(id: string): boolean {
    const status = this.lifecycle.get(id)?.accessor.get(IAgentLoopService).status();
    return status?.state === 'running' || status?.hasPendingRequests === true;
  }

  private makeMember(role: FusionRole, name: string, model: string, effort: string, id?: string): FusionMember {
    return { id: id ?? `fusion-${name}-${randomUUID()}`, name, role, model, effort, transport: 'native', runs: 0, failures: 0, cancellations: 0 };
  }

  private async resolveRoleModel(role: OverrideRole, model: string, effort: string) {
    try { return await resolveFusionModel(this.catalog, model, effort); }
    catch (error) { throw roleResolutionError(role, error); }
  }

  /** Picks a worker, or the idiot-boss coordinator when `coordinator` is set:
   * the coordinator tries its own configured model before the worker chain. */
  private async chooseWorker(name = 'worker', override?: RoleOverrides['worker'], coordinator = false) {
    const prefs = this.preferences();
    if (override !== undefined) {
      const effort = override.effort ?? (coordinator ? prefs.coordinatorEffort : prefs.workerEffort);
      const model = await this.resolveRoleModel('worker', override.model, effort);
      const member = this.makeMember('worker', name, model.id, effort);
      return { member, route: { memberId: member.id, to: member.model, reason: `Override: ${override.model}`, at: Date.now() } };
    }
    const failures: string[] = [];
    const chain: (readonly [string, string])[] = [[prefs.workerModel, prefs.workerEffort], [prefs.museModel, prefs.museEffort], [prefs.terraModel, prefs.terraEffort]];
    if (coordinator) chain.unshift([prefs.coordinatorModel, prefs.coordinatorEffort]);
    for (const [requested, effort] of chain) {
      try {
        const model = await resolveFusionModel(this.catalog, requested, effort);
        const member = this.makeMember('worker', name, model.id, effort);
        const reason = failures.length === 0 ? `Configured primary ${coordinator ? 'coordinator' : 'worker'} is available.` : `Catalog fallback: ${failures.join('; ')}`;
        return { member, route: { memberId: member.id, to: member.model, reason, at: Date.now() } };
      } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    throw fusionError(`no supported worker is configured. ${failures.join('; ')}`);
  }

  private async materialize(member: FusionMember): Promise<IAgentScopeHandle | undefined> {
    if (member.transport === 'claude') return undefined;
    const scope = this.lifecycle.get(member.id) ?? await this.lifecycle.create({
      agentId: member.id,
      binding: { profile: DEFAULT_PROFILE_NAME, model: member.model, thinking: member.effort, strictThinking: true },
      labels: { ...subagentLabels(this.team!.ownerId), fusionRole: member.role },
    });
    this.applyMemberTools(member);
    return scope;
  }

  async restoreTools(agentId: string): Promise<void> {
    const member = await this.member(agentId);
    if (member !== undefined) this.applyMemberTools(member);
  }

  private applyMemberTools(member: FusionMember): void {
    const profile = this.lifecycle.get(member.id)?.accessor.get(IAgentProfileService);
    if (profile === undefined) return;
    if (member.role === 'consultant') {
      profile.update({ activeToolNames: ['Read', 'ReadMediaFile', 'Glob', 'Grep', 'WebSearch', 'FetchURL', 'FusionTeam'] });
    } else {
      profile.addActiveTool('FusionTeam');
    }
    profile.republishStatus();
  }

  private async bindOwner(): Promise<void> {
    const member = this.team!.members.find((entry) => entry.id === this.team!.ownerId)!;
    const scope = this.lifecycle.get(member.id);
    if (scope === undefined) throw fusionError('session owner is not registered.');
    const profile = scope.accessor.get(IAgentProfileService);
    const boundary = scope.accessor.get(IAgentLoopService).tryAcquireQuiescence();
    if (boundary === undefined) throw fusionError('session owner must be idle before enabling the team.');
    try {
      await profile.bind({ profile: profile.data().profileName ?? DEFAULT_PROFILE_NAME, model: member.model, thinking: member.effort, strictThinking: true });
      profile.addActiveTool('FusionTeam');
    } finally { boundary.dispose(); }
  }

  private requireTeam(actorId: string): { team: FusionTeamState; actor: FusionMember } {
    if (!this.flags.enabled(FUSION_FLAG_ID) || !this.team?.enabled) throw fusionError('team is not enabled. Use /swarm fusion.');
    const actor = this.team.members.find((member) => member.id === actorId);
    if (actor === undefined) throw fusionError('sender is not a team member.');
    return { team: this.team, actor };
  }

  private target(name: string): FusionMember {
    const member = this.team!.members.find((entry) => entry.id === name || entry.name === name);
    if (member === undefined) throw fusionError(`unknown member "${name}".`);
    return member;
  }

  private leader(actor: FusionMember): void {
    if (actor.role !== 'ceo' && actor.role !== 'coo') throw fusionError('only CEO/COO may spawn, route or hand off work. Send a message to a leader instead.');
  }

  async execute(actorId: string, input: FusionTeamInput, signal?: AbortSignal, toolCallId?: string): Promise<unknown> {
    input = FusionTeamInputSchema.parse(input);
    signal = signal === undefined ? this.shutdown.signal : AbortSignal.any([signal, this.shutdown.signal]);
    signal.throwIfAborted();
    if (input.action === 'handoff') return this.handoff(actorId, input.target, input.brief, signal, toolCallId);
    return this.serial(async () => {
      const { team, actor } = this.requireTeam(actorId);
      switch (input.action) {
        case 'status': return this.status();
        case 'inbox': return structuredClone(this.pendingMail(actorId));
        case 'ack': {
          team.mail = team.mail.filter((mail) => mail.to !== actorId || !input.ids.includes(mail.id));
          await this.save();
          return { acknowledged: input.ids };
        }
        case 'finish': {
          if (actor.role !== 'coordinator' || !team.task) throw fusionError('finish requires an idiot-boss coordinator and a real user task.');
          if (this.active.size > 0 || team.members.some((member) => member.id !== actorId && this.isRunning(member.id))) throw fusionError('wait for teammate runs before validating.');
          const evidence = input.evidenceToolCallIds.map((id) => team.task!.evidence.find((entry) => entry.toolCallId === id));
          if (evidence.some((entry) => entry === undefined)) return { status: 'needs-user', report: 'No matching independent verification evidence after the latest handoff. Run real checks and inspect their output before accepting work.' };
          team.task.validated = true;
          await this.save();
          return { status: 'evidence-recorded', summary: input.summary, evidence, report: 'Observed verification receipts, not automatic proof of correctness. Report remaining limitations to the user.' };
        }
        case 'message': return this.deliver(actorId, [this.target(input.target)], input.text, team.strategy === 'idiot-boss');
        case 'broadcast': return this.deliver(actorId, team.members.filter((member) => member.id !== actorId), input.text, team.strategy === 'idiot-boss');
        case 'spawn': {
          this.leader(actor);
          if (team.strategy === 'idiot-boss') throw fusionError('idiot-boss keeps one coordinator; the COO implements coherently without cheap implementers.');
          if (team.members.some((member) => member.name === input.name)) throw fusionError('member name already exists.');
          if (team.members.filter((member) => member.role === 'worker').length >= this.preferences().maxWorkers) throw fusionError('worker limit reached.');
          const selected = await this.chooseWorker(input.name);
          team.members.push(selected.member);
          team.routing.push({ ...selected.route, reason: `${input.reason}; ${selected.route.reason}` });
          team.routing = team.routing.slice(-100);
          await this.save();
          await this.materialize(selected.member);
          return structuredClone(selected.member);
        }
        case 'route': {
          this.leader(actor);
          const target = this.target(input.target);
          if (target.role !== 'worker') throw fusionError('routing may only change workers, never leaders or the consultant.');
          if (this.active.has(target.id) || this.isRunning(target.id)) throw fusionError('worker must be idle before model replacement.');
          const model = await resolveFusionModel(this.catalog, input.model, input.effort);
          const scope = await this.materialize(target);
          const boundary = scope!.accessor.get(IAgentLoopService).tryAcquireQuiescence();
          if (boundary === undefined) throw fusionError('worker is no longer idle; retry routing at a safe boundary.');
          try {
            await scope!.accessor.get(IAgentProfileService).bind({ profile: DEFAULT_PROFILE_NAME, model: model.id, thinking: input.effort, strictThinking: true });
            team.routing.push({ memberId: target.id, from: target.model, to: model.id, reason: input.reason, at: Date.now() });
            team.routing = team.routing.slice(-100);
            target.model = model.id;
            target.effort = input.effort;
            await this.save();
          } finally { boundary.dispose(); }
          return structuredClone(target);
        }
      }
    });
  }

  private async deliver(from: string, recipients: readonly FusionMember[], text: string, informational = false): Promise<{ ids: number[]; delivery: string[] }> {
    if (text.length > PACKET_LIMIT) throw fusionError(`packet exceeds ${PACKET_LIMIT} characters.`);
    const team = this.team!;
    for (const recipient of recipients) {
      if (team.mail.filter((mail) => mail.to === recipient.id).length >= MAIL_LIMIT) throw fusionError(`inbox for ${recipient.name} is full; recipient must acknowledge mail.`);
    }
    const mail = recipients.map((recipient): FusionMail => ({ id: team.nextMail++, from, to: recipient.id, text, createdAt: Date.now(), informational }));
    team.mail.push(...mail);
    await this.save();
    if (informational) return { ids: mail.map((entry) => entry.id), delivery: mail.map(() => 'queued; informational data only, not an implementation handoff') };
    const delivery: string[] = [];
    for (const entry of mail) {
      const scope = this.lifecycle.get(entry.to);
      if (scope === undefined || !this.isRunning(entry.to)) { delivery.push('queued'); continue; }
      try {
        await scope.accessor.get(IAgentPromptService).inject({ role: 'user', content: [{ type: 'text', text: this.mailPacket(entry) }], toolCalls: [], origin: ORIGIN });
        delivery.push('injected');
      } catch (error) { delivery.push(`queued; injection failed: ${error instanceof Error ? error.message : String(error)}`); }
    }
    return { ids: mail.map((entry) => entry.id), delivery };
  }

  private pendingMail(id: string): FusionMail[] {
    const result: FusionMail[] = [];
    let size = 0;
    for (const mail of this.team!.mail.filter((entry) => entry.to === id)) {
      if (result.length > 0 && size + mail.text.length > PACKET_LIMIT) break;
      result.push(mail);
      size += mail.text.length;
    }
    return result;
  }

  private mailPacket(mail: FusionMail): string {
    return `Fusion message #${mail.id} from ${mail.from}:\n${mail.text}\nAcknowledge #${mail.id} with FusionTeam after reading.`;
  }

  private reaches(start: string, goal: string, seen = new Set<string>()): boolean {
    if (start === goal) return true;
    if (seen.has(start)) return false;
    seen.add(start);
    return [...(this.waiting.get(start) ?? [])].some((next) => this.reaches(next, goal, seen));
  }

  private async handoff(actorId: string, targetName: string, brief: string, signal?: AbortSignal, toolCallId?: string): Promise<FusionHandoff> {
    const prepared = await this.serial(async () => {
      const { actor, team } = this.requireTeam(actorId);
      if (actor.role !== 'coordinator') this.leader(actor);
      const target = this.target(targetName);
      if (this.reaches(target.id, actorId)) throw fusionError('self-handoff or synchronous call cycle; send a message instead.');
      signal?.throwIfAborted();
      if (team.strategy === 'idiot-boss' && target.role === 'coo') {
        if (!team.task || team.task.handoffs >= 3) return { status: 'needs-user', memberId: target.id, report: 'COO implementation budget exhausted or no real user task is active. Stop and report validation findings to the user. Only a new user-origin turn resets the THREE-handoff budget.' } satisfies FusionHandoff;
        team.task.handoffs++;
        team.task.evidence = [];
        team.task.validated = false;
        await this.save();
      }
      if (this.active.has(target.id) || this.isRunning(target.id)) {
        if (await this.restricted(actorId)) {
          target.readOnly = true;
          this.readOnly.add(target.id);
        }
        const recipientMode = this.lifecycle.get(target.id)?.accessor.get(IAgentPermissionModeService);
        const senderMode = this.lifecycle.get(actorId)?.accessor.get(IAgentPermissionModeService).mode;
        if (recipientMode !== undefined && senderMode !== undefined && recipientMode.mode !== senderMode) recipientMode.setMode('manual');
        const receipt = await this.deliver(actorId, [target], brief);
        return { status: receipt.delivery[0] === 'injected' ? 'injected' : 'queued', memberId: target.id, report: `Brief retained as message #${receipt.ids[0]}; ${receipt.delivery[0]}.` } satisfies FusionHandoff;
      }
      const scope = await this.materialize(target);
      const requester = this.lifecycle.get(actorId);
      if (requester === undefined) throw fusionError('sender scope is unavailable.');
      if (scope !== undefined) {
        scope.accessor.get(IAgentPermissionModeService).setMode(requester.accessor.get(IAgentPermissionModeService).mode);
        scope.accessor.get(IAgentPermissionRulesService).addRules(requester.accessor.get(IAgentPermissionRulesService).rules);
        scope.accessor.get(IAgentUserToolService).inheritUserTools(requester.accessor.get(IAgentUserToolService));
        scope.accessor.get(IAgentProfileService).addActiveTool('FusionTeam');
      }
      target.readOnly = await this.restricted(actorId);
      if (target.readOnly) this.readOnly.add(target.id);
      else this.readOnly.delete(target.id);
      this.parents.set(target.id, actorId);
      this.active.add(target.id);
      const edges = this.waiting.get(actorId) ?? new Set<string>();
      edges.add(target.id);
      this.waiting.set(actorId, edges);
      target.runs++;
      team.running.push(target.id);
      const snapshot = structuredClone(target);
      if (target.transport === 'claude') target.started = true;
      await this.save();
      const mail = target.transport === 'claude' ? this.pendingMail(target.id) : [];
      const packet = mail.map((entry) => `Message #${entry.id} from ${entry.from}: ${entry.text}`).join('\n');
      return { target: snapshot, mailIds: mail.map((entry) => entry.id), prompt: `${roleGuidance(target, team.strategy)}\n\nBrief from ${actor.name}:\n${brief}${packet ? `\n\nDelivered mailbox:\n${packet}` : ''}` };
    });
    if (prepared.status !== undefined) return prepared;
    const { target, prompt } = prepared;
    let usage: TokenUsage | undefined;
    let result: FusionHandoff;
    try {
      signal?.throwIfAborted();
      let report: string;
      if (target.transport === 'claude') {
        const result = await runClaudeDecision({ model: target.model, sessionId: target.sessionId!, resume: target.started === true, prompt, cwd: this.session.cwd, signal });
        report = result.text;
        if (result.usage !== undefined) usage = { inputOther: result.usage.inputTokens, output: result.usage.outputTokens, inputCacheRead: result.usage.cacheReadTokens, inputCacheCreation: result.usage.cacheWriteTokens };
      } else {
        const requester = this.lifecycle.get(actorId)!;
        const controller = new AbortController();
        const runSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
        emitAgentRunSpawned(requester, target.id, { profileName: target.name, parentToolCallId: toolCallId, description: brief.slice(0, 200), model: target.model });
        const run = await this.subagents.run(target.id, { kind: 'prompt', prompt }, { signal: runSignal });
        const outcome = await mirrorAgentRun(requester, run, { profileName: target.name, prompt, signal: runSignal, cancel: (reason) => controller.abort(reason) });
        report = outcome.summary;
        usage = outcome.usage;
      }
      if (report.trim().length === 0) throw fusionError('member returned no report; this is not approval.');
      result = { status: 'completed', validation: 'unverified', report: report.slice(0, PACKET_LIMIT) + (report.length > PACKET_LIMIT ? '\n[Report truncated; ask for a focused follow-up.]' : ''), memberId: target.id };
    } catch (error) {
      const cancelled = signal?.aborted === true || (error instanceof Error && error.name === 'AbortError');
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
      const failureKind = cancelled ? undefined : target.transport === 'claude' ? 'transport' : code.startsWith('provider.') ? 'provider' : 'work';
      result = { status: cancelled ? 'cancelled' : 'failed', failureKind, memberId: target.id, report: `${error instanceof Error ? error.message : String(error)} No automatic replay: prior tool effects may already have occurred.` };
    }
    await this.serial(async () => {
      const member = this.target(target.id);
      member.lastOutcome = result.status === 'completed' ? 'completed' : result.status === 'cancelled' ? 'cancelled' : 'failed';
      member.failureKind = result.failureKind;
      if (result.status === 'completed') {
        member.started = true;
        if (target.transport === 'claude') this.team!.mail = this.team!.mail.filter((mail) => mail.to !== target.id || !prepared.mailIds.includes(mail.id));
        if (usage !== undefined) member.usage = member.transport === 'claude' ? addUsage(member.usage ?? emptyUsage(), usage) : usage;
      } else if (result.status === 'cancelled') member.cancellations++;
      else member.failures++;
      this.active.delete(target.id);
      this.parents.delete(target.id);
      this.waiting.get(actorId)?.delete(target.id);
      this.team!.running = this.team!.running.filter((id) => id !== target.id);
      await this.save();
    });
    return result;
  }
}
