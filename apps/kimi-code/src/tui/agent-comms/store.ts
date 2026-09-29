/**
 * JSONL + agents.json comms store under `{workspace}/.andrewcode/comms/`.
 *
 * Exclusive writers take a mkdir lock. Board and mailboxes are append-only
 * JSONL; agents.json and context.json use write-tmp-rename. No sqlite.
 */

import { randomUUID } from 'node:crypto';

import { assertAgentId, readAgentCards, upsertAgentCardRecord } from './cards';
import {
  appendMailbox,
  dmChannelName,
  extractMentions,
  inboxRecipients,
  readMailbox,
  writeMailbox,
} from './mailbox';
import {
  appendJsonlFile,
  type CommsPaths,
  commsDirExists,
  commsPaths,
  ensureCommsLayout,
  readJsonlFile,
  resolveCommsDir,
  withCommsLock,
} from './paths';
import {
  type AgentCard,
  type AgentCardInput,
  type CommsEvent,
  type CommsEventInput,
  type CommsMessage,
  CommsError,
  type PostMessageInput,
  isCommsMessageKind,
  isNonEmptyString,
  parseCommsEvent,
  parseCommsMessage,
} from './types';

const DEFAULT_INBOX_LIMIT = 100;
const DEFAULT_CHANNEL_LIMIT = 200;

export function initComms(cwd: string): CommsPaths {
  const dir = resolveCommsDir(cwd);
  return withCommsLock(dir, () => ensureCommsLayout(dir));
}

export function listAgents(cwd: string): AgentCard[] {
  const dir = resolveCommsDir(cwd);
  if (!commsDirExists(dir)) return [];
  return readAgentCards(dir);
}

export function upsertAgentCard(cwd: string, input: AgentCardInput): AgentCard {
  const dir = resolveCommsDir(cwd);
  return withCommsLock(dir, () => {
    ensureCommsLayout(dir);
    return upsertAgentCardRecord(dir, input);
  });
}

export function postMessage(cwd: string, input: PostMessageInput): CommsMessage {
  const dir = resolveCommsDir(cwd);
  return withCommsLock(dir, () => {
    ensureCommsLayout(dir);
    const message = buildMessage(input);
    const paths = commsPaths(dir);
    appendJsonlFile(paths.board, message);
    const agents = readAgentCards(dir);
    for (const agentId of inboxRecipients(message, agents)) {
      appendMailbox(dir, agentId, message);
    }
    return message;
  });
}

export function pollInbox(
  cwd: string,
  agentId: string,
  limit: number = DEFAULT_INBOX_LIMIT,
): CommsMessage[] {
  const dir = resolveCommsDir(cwd);
  if (!commsDirExists(dir)) return [];
  const messages = readMailbox(dir, assertAgentId(agentId));
  if (messages.length <= limit) return messages;
  return messages.slice(0, limit);
}

export function ack(cwd: string, agentId: string, messageId: string): CommsMessage {
  const dir = resolveCommsDir(cwd);
  const id = assertAgentId(agentId);
  if (!isNonEmptyString(messageId)) {
    throw new CommsError('message id must be a non-empty string');
  }
  return withCommsLock(dir, () => {
    ensureCommsLayout(dir);
    const inbox = readMailbox(dir, id);
    const found = inbox.find((message) => message.id === messageId.trim());
    if (found === undefined) {
      throw new CommsError(`unknown inbox message: ${messageId}`);
    }
    writeMailbox(
      dir,
      id,
      inbox.filter((message) => message.id !== found.id),
    );
    const ackMessage = buildMessage({
      from: id,
      channel: found.channel,
      kind: 'ack',
      body: found.id,
      threadId: found.id,
    });
    appendJsonlFile(commsPaths(dir).board, ackMessage);
    return found;
  });
}

export function listChannel(
  cwd: string,
  channel: string,
  limit: number = DEFAULT_CHANNEL_LIMIT,
): CommsMessage[] {
  if (!isNonEmptyString(channel)) {
    throw new CommsError('channel must be a non-empty string');
  }
  const dir = resolveCommsDir(cwd);
  if (!commsDirExists(dir)) return [];
  const messages = readJsonlFile(commsPaths(dir).board, parseCommsMessage).filter(
    (message) => message.channel === channel.trim(),
  );
  if (messages.length <= limit) return messages;
  return messages.slice(-limit);
}

export function appendEvent(cwd: string, input: CommsEventInput): CommsEvent {
  const dir = resolveCommsDir(cwd);
  return withCommsLock(dir, () => {
    ensureCommsLayout(dir);
    if (!isNonEmptyString(input.kind)) {
      throw new CommsError('event kind must be a non-empty string');
    }
    const event: CommsEvent = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      kind: input.kind.trim(),
      body: input.body,
      path: input.path,
      agents: input.agents ? [...input.agents] : undefined,
    };
    appendJsonlFile(commsPaths(dir).events, event);
    return event;
  });
}

export function recordCollision(
  cwd: string,
  path: string,
  agents: readonly string[],
): CommsEvent {
  if (!isNonEmptyString(path)) {
    throw new CommsError('collision path must be a non-empty string');
  }
  const names = agents.map((agent) => agent.trim()).filter((agent) => agent.length > 0);
  return appendEvent(cwd, {
    kind: 'collision',
    body: `same-file edit: ${path.trim()} (${names.join(', ') || 'unknown'})`,
    path: path.trim(),
    agents: names,
  });
}

export function listBoard(cwd: string, limit: number = DEFAULT_CHANNEL_LIMIT): CommsMessage[] {
  const dir = resolveCommsDir(cwd);
  if (!commsDirExists(dir)) return [];
  const messages = readJsonlFile(commsPaths(dir).board, parseCommsMessage);
  if (messages.length <= limit) return messages;
  return messages.slice(-limit);
}

export function listEvents(cwd: string, limit: number = DEFAULT_CHANNEL_LIMIT): CommsEvent[] {
  const dir = resolveCommsDir(cwd);
  if (!commsDirExists(dir)) return [];
  const events = readJsonlFile(commsPaths(dir).events, parseCommsEvent);
  if (events.length <= limit) return events;
  return events.slice(-limit);
}

export function summarizeComms(cwd: string = process.cwd()): string {
  const dir = resolveCommsDir(cwd);
  if (!commsDirExists(dir)) return 'comms: empty (not initialized)';
  const agents = readAgentCards(dir);
  const messages = readJsonlFile(commsPaths(dir).board, parseCommsMessage);
  const collisions = readJsonlFile(commsPaths(dir).events, parseCommsEvent).filter(
    (event) => event.kind === 'collision',
  );
  const last = messages[messages.length - 1];
  const parts = [
    `${agents.length} agent${agents.length === 1 ? '' : 's'}`,
    `${messages.length} message${messages.length === 1 ? '' : 's'}`,
  ];
  if (collisions.length > 0) {
    parts.push(`${collisions.length} collision${collisions.length === 1 ? '' : 's'}`);
  }
  if (last) {
    const preview = last.body.length > 40 ? `${last.body.slice(0, 37)}...` : last.body;
    parts.push(`last ${last.channel} ${last.from}: ${preview}`);
  }
  return `comms: ${parts.join(' · ')}`;
}

function buildMessage(input: PostMessageInput): CommsMessage {
  if (!isNonEmptyString(input.from)) {
    throw new CommsError('from must be a non-empty string');
  }
  if (typeof input.body !== 'string') {
    throw new CommsError('body must be a string');
  }
  const kind = input.kind ?? 'message';
  if (!isCommsMessageKind(kind)) {
    throw new CommsError(`invalid message kind: ${String(kind)}`);
  }
  const from = input.from.trim();
  const to = input.to?.trim() ? input.to.trim() : undefined;
  const mentions = extractMentions(input.body, input.mentions);
  let channel = input.channel?.trim() ? input.channel.trim() : undefined;
  if (channel === undefined) {
    channel = to !== undefined ? dmChannelName(from, to) : 'hive';
  }
  return {
    id: randomUUID(),
    ts: new Date().toISOString(),
    from,
    to,
    channel,
    kind,
    body: input.body,
    mentions,
    threadId: input.threadId?.trim() ? input.threadId.trim() : undefined,
    taskId: input.taskId?.trim() ? input.taskId.trim() : undefined,
  };
}
