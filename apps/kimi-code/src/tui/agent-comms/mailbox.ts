/**
 * Per-agent inboxes (`mailbox/<id>.jsonl`) — hcom poll/send/ack, no daemon.
 */

import { appendJsonlFile, readJsonlFile, writeJsonlFile } from './paths';
import { mailboxFilePath } from './cards';
import {
  type AgentCard,
  type CommsMessage,
  ROLE_CHANNELS,
  parseCommsMessage,
} from './types';

export function dmChannelName(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  return left <= right ? `dm:${left}:${right}` : `dm:${right}:${left}`;
}

export function parseDmParties(channel: string): [string, string] | undefined {
  if (!channel.startsWith('dm:')) return undefined;
  const rest = channel.slice(3);
  const sep = rest.indexOf(':');
  if (sep <= 0 || sep === rest.length - 1) return undefined;
  const left = rest.slice(0, sep);
  const right = rest.slice(sep + 1);
  if (left.length === 0 || right.length === 0 || right.includes(':')) return undefined;
  return [left, right];
}

export function readMailbox(dir: string, agentId: string): CommsMessage[] {
  return readJsonlFile(mailboxFilePath(dir, agentId), parseCommsMessage);
}

export function appendMailbox(dir: string, agentId: string, message: CommsMessage): void {
  appendJsonlFile(mailboxFilePath(dir, agentId), message);
}

export function writeMailbox(dir: string, agentId: string, messages: readonly CommsMessage[]): void {
  writeJsonlFile(mailboxFilePath(dir, agentId), messages);
}

export function removeMailboxMessage(
  dir: string,
  agentId: string,
  messageId: string,
): CommsMessage[] {
  const remaining = readMailbox(dir, agentId).filter((message) => message.id !== messageId);
  writeMailbox(dir, agentId, remaining);
  return remaining;
}

export function inboxRecipients(
  message: CommsMessage,
  agents: readonly AgentCard[],
): string[] {
  const recipients = new Set<string>();
  if (message.to && message.to !== message.from) recipients.add(message.to);
  for (const mention of message.mentions) {
    if (mention !== message.from) recipients.add(mention);
  }
  const dm = parseDmParties(message.channel);
  if (dm) {
    for (const party of dm) {
      if (party !== message.from) recipients.add(party);
    }
  }
  for (const agent of agents) {
    if (agent.id === message.from) continue;
    const rooms = ROLE_CHANNELS[agent.role];
    if (rooms.includes(message.channel)) recipients.add(agent.id);
  }
  return [...recipients];
}

export function extractMentions(body: string, extra?: readonly string[]): string[] {
  const found = new Set<string>();
  if (extra) {
    for (const item of extra) {
      const trimmed = item.trim();
      if (trimmed.length > 0) found.add(trimmed);
    }
  }
  for (const match of body.matchAll(/@([A-Za-z0-9._:-]+)/g)) {
    const name = match[1];
    if (name) found.add(name);
  }
  return [...found];
}
