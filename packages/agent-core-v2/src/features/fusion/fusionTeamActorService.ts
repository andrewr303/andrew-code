/**
 * `fusion` domain — Agent-owned team identity, guidance and execution guards.
 *
 * Authenticates tool and command senders through `scopeContext`, contributes
 * role-specific context through `contextInjector`, and enforces read-only and
 * delegation boundaries at `toolExecutor`. Observes authentic user turns and
 * verification tool receipts. Stores command feedback in `contextMemory` and
 * publishes `warning`/`fusion.status` for SDK/TUI clients that drop context
 * splices, without launching a model turn. The coordinator is Session-owned.
 */
import { Service } from '#/_base/di/service';
import { IAgentContextInjectorService } from '#/agent/contextInjector/contextInjector';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import { IEventBus } from '#/app/event/eventBus';
import { IWireService } from '#/wire/wire';
import {
  IAgentFusionTeamService, ISessionFusionTeamService, FUSION_READ_TOOLS, FUSION_DELEGATE_TOOLS,
  PACKET_LIMIT, roleGuidance, type FusionMail, type FusionTeamInput,
} from './fusionTeam';

export class AgentFusionTeamService extends Service implements IAgentFusionTeamService {
  declare readonly _serviceBrand: undefined;
  private boundary: Promise<void> = Promise.resolve();
  constructor(
    @ISessionFusionTeamService private readonly team: ISessionFusionTeamService,
    @IAgentScopeContext private readonly scope: IAgentScopeContext,
    @IAgentContextMemoryService private readonly context: IAgentContextMemoryService,
    @IAgentContextInjectorService injector: IAgentContextInjectorService,
    @IAgentToolExecutorService executor: IAgentToolExecutorService,
    @IEventBus private readonly events: IEventBus,
    @IWireService wire: IWireService,
  ) {
    super();
    this._register(wire.hooks.onDidRestore.register('fusion-team-tools', async (_event, next) => {
      await next();
      await this.team.restoreTools(this.scope.agentId);
    }));
    this._register(events.subscribe('turn.started', (event) => {
      this.boundary = this.team.beginTask(this.scope.agentId, event);
      void this.boundary.catch(() => {});
    }));
    this._register(executor.hooks.onDidExecuteTool.register('fusion-verification', async (event, next) => {
      await next();
      await this.boundary;
      await this.team.recordEvidence(this.scope.agentId, event);
    }));
    this._register(injector.register('fusion-team-guidance', async ({ isNewTurn }) => {
      if (!isNewTurn) return undefined;
      await this.boundary;
      const member = await this.team.member(this.scope.agentId);
      if (member === undefined) return undefined;
      const status = await this.team.status();
      const inbox = await this.team.execute(this.scope.agentId, { action: 'inbox' }) as FusionMail[];
      const mail = inbox.map((entry) => `#${entry.id} from ${entry.from}: ${entry.text}`).join('\n');
      return `${roleGuidance(member, status.team?.strategy)}\n${mail.length === 0 ? '' : `Unread mail (ack by ID after reading):\n${mail.slice(0, PACKET_LIMIT)}${mail.length > PACKET_LIMIT ? '\n[More mail: call FusionTeam inbox.]' : ''}`}`;
    }));
    this._register(executor.onBeforeExecuteTool(async (event) => {
      const member = await this.team.member(this.scope.agentId);
      if (member === undefined) return;
      const name = event.toolCall.name;
      if (FUSION_DELEGATE_TOOLS.has(name)) {
        event.veto({ isError: true, output: 'Fusion delegates must use FusionTeam; other spawning, external panels and scheduled workers are disabled.' });
        return;
      }
      if (!await this.team.restricted(this.scope.agentId, true)) return;
      if (FUSION_READ_TOOLS.has(name)) return;
      if (name === 'FusionTeam') {
        const action = typeof event.args === 'object' && event.args !== null && 'action' in event.args ? event.args.action : undefined;
        if (['status', 'inbox', 'ack', 'message', 'broadcast'].includes(String(action))) return;
        if (member.role !== 'consultant' && action === 'handoff') return;
      }
      event.veto({ isError: true, output: 'Fusion read-only boundary: consultant or inherited plan mode permits only read tools and team communication. Shell, edits, configuration and spawning are not allowed.' });
    }));
  }

  async command(command: string): Promise<void> {
    const status = await this.team.command(this.scope.agentId, command.trim() || 'status');
    const lines = status.team?.members.map((member) => `${member.name}: ${member.actualModel ?? member.model}/${member.actualEffort ?? member.effort}; ${member.transport}; runs=${member.runs}; failures=${member.failures}; cancellations=${member.cancellations}`) ?? [];
    const summary = `Fusion ${status.enabled ? 'on' : 'off'}: ${status.team?.strategy ?? 'genius-boss'}${status.team?.dual ? ' (dual)' : ''}\n${lines.join('\n')}\n${status.team?.strategy === 'idiot-boss' ? `COO handoffs this user task: ${status.team.task?.handoffs ?? 0}/3; validation: ${status.team.task?.validated ? 'evidence recorded' : 'unverified'}.\n` : ''}${status.team && !status.team.hasOriginalBinding ? 'Legacy team has no original binding snapshot; off cannot reconstruct its original model.\n' : ''}Use FusionTeam status for IDs, unread counts and recent routing. Independent histories do not guarantee cache hits.`;
    const text = summary.length > 2900 ? `${summary.slice(0, 2900)}\n[Summary shortened; use FusionTeam status.]` : summary;
    this.context.append({ role: 'assistant', content: [{ type: 'text', text }], toolCalls: [], origin: { kind: 'system_trigger', name: 'fusion-status' } });
    this.events.publish({ type: 'warning', code: 'fusion.status', message: text });
  }

  async execute(input: FusionTeamInput, signal?: AbortSignal, toolCallId?: string): Promise<unknown> {
    await this.boundary;
    return this.team.execute(this.scope.agentId, input, signal, toolCallId);
  }
}
