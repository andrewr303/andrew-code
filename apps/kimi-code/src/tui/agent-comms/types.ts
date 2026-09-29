/**
 * Agent communications bus — shared envelope and agent-card types.
 *
 * Combines hcom (named agents, inbox, poll/ack, collision notes), agmsg
 * (append-only JSONL, rooms, replay), A2A (agent cards + task fields), and
 * hive board (rooms + `dm:a:b`). Persistence is files only; no daemon.
 */

export const COMMS_MESSAGE_KINDS = [
  'message',
  'system',
  'ack',
  'presence',
  'handoff',
  'task',
] as const;

export type CommsMessageKind = (typeof COMMS_MESSAGE_KINDS)[number];

export const AGENT_ROLES = [
  'architect',
  'operator',
  'captain',
  'worker',
  'child',
  'human',
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_STATUSES = ['online', 'offline', 'busy', 'idle', 'error'] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const DEFAULT_COMMS_CHANNELS = [
  'hive',
  'architect',
  'captains',
  'workers',
  'system',
] as const;

export type DefaultCommsChannel = (typeof DEFAULT_COMMS_CHANNELS)[number];

export const ROLE_CHANNELS: Readonly<Record<AgentRole, readonly string[]>> = {
  architect: ['hive', 'architect', 'system'],
  operator: ['hive', 'architect', 'captains', 'system'],
  captain: ['hive', 'captains'],
  worker: ['hive', 'workers'],
  child: ['hive', 'workers'],
  human: ['hive', 'system'],
};

export interface CommsMessage {
  readonly id: string;
  readonly ts: string;
  readonly from: string;
  readonly to?: string;
  readonly channel: string;
  readonly kind: CommsMessageKind;
  readonly body: string;
  readonly mentions: readonly string[];
  readonly threadId?: string;
  readonly taskId?: string;
}

export interface PostMessageInput {
  readonly from: string;
  readonly to?: string;
  readonly channel?: string;
  readonly kind?: CommsMessageKind;
  readonly body: string;
  readonly mentions?: readonly string[];
  readonly threadId?: string;
  readonly taskId?: string;
}

export interface AgentCard {
  readonly id: string;
  readonly role: AgentRole;
  readonly provider?: string;
  readonly model?: string;
  readonly capabilities: readonly string[];
  readonly status: AgentStatus;
}

export interface AgentCardInput {
  readonly id: string;
  readonly role: AgentRole;
  readonly provider?: string;
  readonly model?: string;
  readonly capabilities?: readonly string[];
  readonly status?: AgentStatus;
}

export interface CommsEvent {
  readonly id: string;
  readonly ts: string;
  readonly kind: string;
  readonly body: string;
  readonly path?: string;
  readonly agents?: readonly string[];
}

export interface CommsEventInput {
  readonly kind: string;
  readonly body: string;
  readonly path?: string;
  readonly agents?: readonly string[];
}

export class CommsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommsError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isCommsMessageKind(value: unknown): value is CommsMessageKind {
  return typeof value === 'string' && (COMMS_MESSAGE_KINDS as readonly string[]).includes(value);
}

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && (AGENT_ROLES as readonly string[]).includes(value);
}

export function isAgentStatus(value: unknown): value is AgentStatus {
  return typeof value === 'string' && (AGENT_STATUSES as readonly string[]).includes(value);
}

export function parseCommsMessage(value: unknown): CommsMessage | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value['id'])) return undefined;
  if (!isNonEmptyString(value['ts'])) return undefined;
  if (!isNonEmptyString(value['from'])) return undefined;
  if (!isNonEmptyString(value['channel'])) return undefined;
  if (!isCommsMessageKind(value['kind'])) return undefined;
  if (typeof value['body'] !== 'string') return undefined;
  const mentions = parseStringList(value['mentions']);
  if (mentions === undefined) return undefined;
  const to = optionalString(value['to']);
  const threadId = optionalString(value['threadId'] ?? value['thread_id']);
  const taskId = optionalString(value['taskId'] ?? value['task_id']);
  return {
    id: value['id'],
    ts: value['ts'],
    from: value['from'],
    to,
    channel: value['channel'],
    kind: value['kind'],
    body: value['body'],
    mentions,
    threadId,
    taskId,
  };
}

export function parseAgentCard(value: unknown): AgentCard | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value['id'])) return undefined;
  if (!isAgentRole(value['role'])) return undefined;
  const status = value['status'] ?? 'online';
  if (!isAgentStatus(status)) return undefined;
  const capabilities = parseStringList(value['capabilities'] ?? []);
  if (capabilities === undefined) return undefined;
  const provider = optionalString(value['provider']);
  const model = optionalString(value['model']);
  return {
    id: value['id'],
    role: value['role'],
    provider,
    model,
    capabilities,
    status,
  };
}

export function parseCommsEvent(value: unknown): CommsEvent | undefined {
  if (!isRecord(value)) return undefined;
  if (!isNonEmptyString(value['id'])) return undefined;
  if (!isNonEmptyString(value['ts'])) return undefined;
  if (!isNonEmptyString(value['kind'])) return undefined;
  if (typeof value['body'] !== 'string') return undefined;
  const path = optionalString(value['path']);
  const agents = value['agents'] === undefined ? undefined : parseStringList(value['agents']);
  if (value['agents'] !== undefined && agents === undefined) return undefined;
  return {
    id: value['id'],
    ts: value['ts'],
    kind: value['kind'],
    body: value['body'],
    path,
    agents,
  };
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.trim().length === 0) return undefined;
    out.push(item.trim());
  }
  return out;
}
