import { extractText, type Message } from '#/kosong/contract/message';

export const CODEX_TURN_STATE_HEADER = 'x-codex-turn-state';
export const CODEX_BETA_FEATURES_HEADER = 'x-codex-beta-features';
export const CODEX_REMOTE_COMPACTION_V2_FEATURE = 'remote_compaction_v2';
export const CODEX_COMPACTION_TRIGGER_TEXT = '[[andrewcode:codex-compaction-trigger]]';
export const CODEX_COMPACTION_ITEM_PREFIX = '[[andrewcode:codex-compaction]]';
export const CODEX_COMPACTION_HUMAN_SUMMARY = '[Codex remote compaction]';
export const CODEX_REMOTE_COMPACTION_V2_RETAINED_USER_TOKENS = 64_000;

export function isCodexResponsesBaseUrl(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || baseUrl.length === 0) return false;
  return baseUrl.includes('chatgpt.com/backend-api/codex');
}

export function sanitizeCodexCompactionItem(item: unknown): Record<string, unknown> {
  const raw =
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : {};
  const encrypted = raw['encrypted_content'];
  const replay: Record<string, unknown> = { type: 'compaction' };
  if (typeof encrypted === 'string' && encrypted.length > 0) {
    replay['encrypted_content'] = encrypted;
  }
  return replay;
}

export function encodeCodexCompactionItem(item: unknown): string {
  return `${CODEX_COMPACTION_ITEM_PREFIX}${JSON.stringify(sanitizeCodexCompactionItem(item))}`;
}

export function mergeCodexBetaFeatures(
  existing: string | undefined,
  feature: string,
): string {
  const features = (existing ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (!features.includes(feature)) features.push(feature);
  return features.join(',');
}

export function decodeCodexCompactionItem(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith(CODEX_COMPACTION_ITEM_PREFIX)) return undefined;
  const raw = trimmed.slice(CODEX_COMPACTION_ITEM_PREFIX.length);
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function isCodexCompactionTriggerMessage(message: Message): boolean {
  return extractText(message).trim() === CODEX_COMPACTION_TRIGGER_TEXT;
}

export function tryDecodeCodexCompactionCarrier(message: Message): unknown | undefined {
  return decodeCodexCompactionItem(extractText(message));
}

export class CodexTurnStateCell {
  private value: string | undefined;

  beginTurn(): void {
    this.value = undefined;
  }

  peek(): string | undefined {
    return this.value;
  }

  bind(next: string): void {
    if (this.value === undefined && next.length > 0) {
      this.value = next;
    }
  }
}

export function readHeader(
  headers: { get?(name: string): string | null } | Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  if (typeof headers.get === 'function') {
    const value = headers.get(name) ?? headers.get(name.toLowerCase());
    return value === null || value.length === 0 ? undefined : value;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()];
}
