/**
 * `advisor` domain — `IAdvisorService` implementation.
 *
 * On `turn.ended` (completed turns only) projects the transcript tail
 * through `contextProjector`, sends it to the advisor model binding via
 * `llmRequester.request` with a review system prompt and no tools, parses
 * the returned `aside:` / `concern:` / `blocker:` notes, and injects each
 * as a `<system-reminder>` through `systemReminder` so the main agent sees
 * the note at the next step and course-corrects (or explains why it won't).
 * A `blocker` additionally enqueues a steer message so the turn does not
 * silently continue past a hard objection. The binding resolves through the
 * `secondary-model` flag machinery (`resolveSubagentBinding` with no
 * explicit choice — the advisor is just another secondary-model consumer);
 * without a configured secondary model the advisor stays inert. Empty or
 * unparseable reviews inject nothing. Bound at Agent scope — contributed
 * into every Agent scope by `AdvisorFeature`
 * (`features/advisor/advisorFeature`).
 */

import { Service } from '#/_base/di/service';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import type { ContextMessage } from '#/agent/contextMemory/types';
import { IAgentContextProjectorService } from '#/agent/contextProjector/contextProjector';
import { IAgentLLMRequesterService } from '#/agent/llmRequester/llmRequester';
import { IAgentLoopService } from '#/agent/loop/loop';
import { MessageStepRequest } from '#/agent/loop/stepRequest';
import { USER_PROMPT_ORIGIN } from '#/agent/contextMemory/types';
import { IAgentProfileService } from '#/agent/profile/profile';
import { IAgentSystemReminderService } from '#/agent/systemReminder/systemReminder';
import { IConfigService } from '#/app/config/config';
import { IEventBus } from '#/app/event/eventBus';
import { IFlagService } from '#/app/flag/flag';
import { IModelCatalog } from '#/kosong/model/catalog';
import type { Message } from '#/kosong/contract/message';
import { resolveSubagentBinding } from '#/session/subagent/configSection';
import { SECONDARY_MODEL_FLAG_ID } from '#/session/subagent/flag';
import { IAdvisorService, type AdvisorNote, type AdvisorSeverity } from './advisor';

const ADVISOR_TAIL_MESSAGES = 20;
const ADVISOR_SYSTEM_PROMPT = [
  'You are a code-review advisor watching another agent work. Read the transcript tail below.',
  'Reply with zero or more notes, one per line, each prefixed with exactly one of:',
  'aside: <quiet observation the doer may find useful>',
  'concern: <something that looks wrong and deserves a second look>',
  'blocker: <a hard problem that must be fixed before continuing>',
  'If everything looks fine, reply with exactly: ok',
  'Keep each note to one or two sentences. Never act — only observe.',
].join('\n');

export class AgentAdvisorService extends Service implements IAdvisorService {
  declare readonly _serviceBrand: undefined;

  private reviewing = false;

  constructor(
    @IAgentContextMemoryService private readonly context: IAgentContextMemoryService,
    @IAgentContextProjectorService private readonly projector: IAgentContextProjectorService,
    @IAgentLLMRequesterService private readonly llmRequester: IAgentLLMRequesterService,
    @IAgentLoopService private readonly loop: IAgentLoopService,
    @IAgentProfileService private readonly profile: IAgentProfileService,
    @IAgentSystemReminderService private readonly reminders: IAgentSystemReminderService,
    @IConfigService private readonly configService: IConfigService,
    @IEventBus eventBus: IEventBus,
    @IFlagService private readonly flags: IFlagService,
    @IModelCatalog private readonly modelCatalog: IModelCatalog,
  ) {
    super();
    this._register(
      eventBus.subscribe('turn.ended', (event) => {
        if (event.reason !== 'completed') return;
        void this.reviewTurn(event.turnId).catch(() => undefined);
      }),
    );
  }

  enabled(): boolean {
    if (!this.flags.enabled(SECONDARY_MODEL_FLAG_ID)) return false;
    const own = this.profile.data();
    if (own.modelAlias === undefined) return false;
    try {
      const binding = resolveSubagentBinding(
        this.configService,
        this.flags,
        { modelAlias: own.modelAlias, thinkingLevel: own.thinkingLevel },
      );
      this.modelCatalog.get(binding.model);
      return true;
    } catch {
      return false;
    }
  }

  async reviewTurn(turnId: number): Promise<readonly AdvisorNote[]> {
    if (this.reviewing || !this.enabled()) return [];
    this.reviewing = true;
    try {
      const messages = this.tailMessages();
      if (messages.length === 0) return [];
      const finish = await this.llmRequester.request(
        {
          messages,
          tools: [],
          systemPrompt: ADVISOR_SYSTEM_PROMPT,
          source: { type: 'operation', turnId, requestKind: 'advisor_review' },
        },
        undefined,
        AbortSignal.timeout(60_000),
      );
      const notes = parseAdvisorNotes(finish.message);
      this.injectNotes(notes);
      return notes;
    } catch {
      return [];
    } finally {
      this.reviewing = false;
    }
  }

  private tailMessages(): readonly Message[] {
    const history: readonly ContextMessage[] = this.context.get();
    const tail = history.slice(-ADVISOR_TAIL_MESSAGES);
    try {
      return this.projector.project(tail);
    } catch {
      return [];
    }
  }

  private injectNotes(notes: readonly AdvisorNote[]): void {
    let blocked = false;
    for (const note of notes) {
      this.reminders.appendSystemReminder(`Advisor ${note.severity}: ${note.text}`, {
        kind: 'injection',
        variant: 'advisor',
      });
      if (note.severity === 'blocker') blocked = true;
    }
    if (blocked) {
      this.loop.enqueue(
        new MessageStepRequest(
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'An advisor raised a blocker on the previous turn. Address it before continuing, or explain why it does not apply.',
              },
            ],
            toolCalls: [],
            origin: USER_PROMPT_ORIGIN,
          },
          { kind: 'advisor_blocker', admission: 'activeOrNextTurn' },
        ),
      );
    }
  }
}

function parseAdvisorNotes(message: Message): AdvisorNote[] {
  const text = message.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
  const notes: AdvisorNote[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.toLowerCase() === 'ok') continue;
    const match = /^(aside|concern|blocker)\s*:\s*(.+)$/i.exec(trimmed);
    if (match === null) continue;
    const severity = match[1]!.toLowerCase() as AdvisorSeverity;
    const noteText = match[2]!.trim();
    if (noteText.length === 0) continue;
    notes.push({ severity, text: noteText });
  }
  return notes;
}

export { AgentAdvisorService as Advisor };
