/**
 * Agent cards (`agents.json`) — A2A-style identity for the comms bus.
 */

import { join } from 'node:path';

import { commsPaths, readJsonFile, writeJsonAtomic } from './paths';
import {
  type AgentCard,
  type AgentCardInput,
  CommsError,
  isAgentRole,
  isAgentStatus,
  isNonEmptyString,
  isRecord,
  parseAgentCard,
} from './types';

export function readAgentCards(dir: string): AgentCard[] {
  const raw = readJsonFile(commsPaths(dir).agents);
  const list = Array.isArray(raw)
    ? raw
    : isAgentsEnvelope(raw)
      ? raw.agents
      : [];
  const cards: AgentCard[] = [];
  for (const item of list) {
    const card = parseAgentCard(item);
    if (card) cards.push(card);
  }
  return cards;
}

function isAgentsEnvelope(value: unknown): value is { readonly agents: readonly unknown[] } {
  return isRecord(value) && Array.isArray(value['agents']);
}

export function writeAgentCards(dir: string, cards: readonly AgentCard[]): void {
  writeJsonAtomic(commsPaths(dir).agents, cards);
}

export function upsertAgentCardRecord(dir: string, input: AgentCardInput): AgentCard {
  const id = assertAgentId(input.id);
  if (!isAgentRole(input.role)) {
    throw new CommsError(`invalid agent role: ${String(input.role)}`);
  }
  if (input.status !== undefined && !isAgentStatus(input.status)) {
    throw new CommsError(`invalid agent status: ${String(input.status)}`);
  }
  const cards = readAgentCards(dir);
  const index = cards.findIndex((card) => card.id === id);
  const existing = index >= 0 ? cards[index] : undefined;
  const next: AgentCard = {
    id,
    role: input.role,
    provider: input.provider ?? existing?.provider,
    model: input.model ?? existing?.model,
    capabilities:
      input.capabilities !== undefined ? [...input.capabilities] : [...(existing?.capabilities ?? [])],
    status: input.status ?? existing?.status ?? 'online',
  };
  if (index >= 0) {
    cards[index] = next;
  } else {
    cards.push(next);
  }
  writeAgentCards(dir, cards);
  return next;
}

export function assertAgentId(id: string): string {
  if (!isNonEmptyString(id)) {
    throw new CommsError('agent id must be a non-empty string');
  }
  const trimmed = id.trim();
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new CommsError('agent id must not contain path separators');
  }
  return trimmed;
}

export function mailboxFileName(agentId: string): string {
  return `${assertAgentId(agentId).replace(/[^A-Za-z0-9._-]+/g, '_')}.jsonl`;
}

export function mailboxFilePath(dir: string, agentId: string): string {
  return join(commsPaths(dir).mailbox, mailboxFileName(agentId));
}
