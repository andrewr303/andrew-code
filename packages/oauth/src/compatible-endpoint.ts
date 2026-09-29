import { readApiErrorMessage } from './api-error';
import { CUSTOM_REGISTRY_MODEL_FIELDS, mergeRefreshedModelAlias } from './model-alias-merge';
import type { ManagedKimiConfigShape, ManagedKimiModelAlias } from './managed-kimi-code';
import { isRecord } from './utils';

export type CompatibleEndpointProtocol = 'openai' | 'openai_responses' | 'anthropic';

export interface CompatibleEndpointSource {
  readonly kind: 'compatibleEndpoint';
  readonly protocol: CompatibleEndpointProtocol;
  readonly displayName: string;
}

export interface CompatibleListedModel {
  readonly id: string;
  readonly displayName?: string;
  readonly contextLength?: number;
  readonly capabilities?: readonly string[];
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
}

export class CompatibleEndpointApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'CompatibleEndpointApiError';
    this.status = status;
  }
}

export const COMPATIBLE_ENDPOINT_DEFAULT_MAX_CONTEXT = 131072;

const RESERVED_PROVIDER_IDS = new Set([
  'managed:kimi-code',
  'kimi-code',
  'moonshot-cn',
  'moonshot-ai',
  'xai',
  'codex',
  'perplexity',
  'qwen-token-plan',
  'qwen-token-plan-anthropic',
]);

export function slugifyProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function assertUsableProviderId(id: string): void {
  if (id.length === 0) {
    throw new Error('Provider name must contain at least one letter or digit.');
  }
  if (RESERVED_PROVIDER_IDS.has(id)) {
    throw new Error(`"${id}" is reserved. Choose a different provider name.`);
  }
}

export function isCompatibleEndpointSource(value: unknown): value is CompatibleEndpointSource {
  if (!isRecord(value) || value['kind'] !== 'compatibleEndpoint') return false;
  const protocol = value['protocol'];
  const displayName = value['displayName'];
  if (protocol !== 'openai' && protocol !== 'openai_responses' && protocol !== 'anthropic') {
    return false;
  }
  return typeof displayName === 'string' && displayName.length > 0;
}

export function readCompatibleEndpointSource(provider: unknown): CompatibleEndpointSource | undefined {
  if (!isRecord(provider)) return undefined;
  return isCompatibleEndpointSource(provider['source']) ? provider['source'] : undefined;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function readContextLength(item: Record<string, unknown>): number | undefined {
  return (
    parsePositiveInt(item['context_length']) ??
    parsePositiveInt(item['context_window']) ??
    parsePositiveInt(item['max_context']) ??
    parsePositiveInt(item['max_context_length']) ??
    parsePositiveInt(isRecord(item['limit']) ? item['limit']['context'] : undefined)
  );
}

function readDisplayName(item: Record<string, unknown>, fallbackId: string): string | undefined {
  const displayName = item['display_name'];
  if (typeof displayName === 'string' && displayName.length > 0) return displayName;
  const name = item['name'];
  if (typeof name === 'string' && name.length > 0 && name !== fallbackId) return name;
  return undefined;
}

function isNonChatModelId(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.startsWith('wan') ||
    lower.startsWith('happyhorse') ||
    lower.includes('embedding') ||
    lower.includes('whisper') ||
    lower.includes('tts') ||
    lower.includes('rerank') ||
    lower.includes('moderation')
  );
}

function toListedModel(item: unknown): CompatibleListedModel | undefined {
  if (!isRecord(item)) return undefined;
  const id = item['id'];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (isNonChatModelId(id)) return undefined;
  const contextLength = readContextLength(item);
  const displayName = readDisplayName(item, id);
  const capabilities: string[] = ['tool_use'];
  if (item['supports_reasoning'] === true || item['reasoning'] === true) capabilities.push('thinking');
  const modalities = item['modalities'];
  const inputModalities = isRecord(modalities) ? modalities['input'] : item['input_modalities'];
  if (Array.isArray(inputModalities) && inputModalities.includes('image')) {
    capabilities.push('image_in');
  } else if (item['supports_image_in'] === true) {
    capabilities.push('image_in');
  }
  return {
    id,
    displayName,
    contextLength,
    capabilities,
  };
}

function parseModelsPayload(payload: unknown, endpoint: string): CompatibleListedModel[] {
  if (!isRecord(payload)) {
    throw new Error(`Unexpected models response from ${endpoint}.`);
  }
  const data = payload['data'];
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected models response from ${endpoint}.`);
  }
  return data
    .map((item) => toListedModel(item))
    .filter((item): item is CompatibleListedModel => item !== undefined);
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<{ readonly ok: boolean; readonly status: number; readonly payload: unknown }> {
  const res = await fetchImpl(url, { headers, signal });
  if (!res.ok) {
    throw new CompatibleEndpointApiError(
      await readApiErrorMessage(res, `Failed to list models (HTTP ${res.status}).`),
      res.status,
    );
  }
  return { ok: true, status: res.status, payload: await res.json() };
}

export async function fetchCompatibleEndpointModels(
  options: {
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly protocol: CompatibleEndpointProtocol;
    readonly fetchImpl?: typeof fetch;
    readonly signal?: AbortSignal;
  },
): Promise<CompatibleListedModel[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (baseUrl.length === 0) {
    throw new Error('Endpoint URL cannot be empty.');
  }

  if (options.protocol === 'anthropic') {
    const anthropicUrl = `${baseUrl}/v1/models`;
    try {
      const { payload } = await fetchJson(
        anthropicUrl,
        {
          'x-api-key': options.apiKey,
          'anthropic-version': '2023-06-01',
          Accept: 'application/json',
        },
        fetchImpl,
        options.signal,
      );
      return parseModelsPayload(payload, anthropicUrl);
    } catch (error) {
      if (error instanceof CompatibleEndpointApiError && error.status === 404) {
        const openaiStyle = `${baseUrl}/models`;
        const { payload } = await fetchJson(
          openaiStyle,
          {
            Authorization: `Bearer ${options.apiKey}`,
            Accept: 'application/json',
          },
          fetchImpl,
          options.signal,
        );
        return parseModelsPayload(payload, openaiStyle);
      }
      throw error;
    }
  }

  const openaiUrl = `${baseUrl}/models`;
  const { payload } = await fetchJson(
    openaiUrl,
    {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: 'application/json',
    },
    fetchImpl,
    options.signal,
  );
  return parseModelsPayload(payload, openaiUrl);
}

export function applyCompatibleEndpointConfig(
  config: ManagedKimiConfigShape,
  options: {
    readonly providerId: string;
    readonly displayName: string;
    readonly protocol: CompatibleEndpointProtocol;
    readonly baseUrl: string;
    readonly apiKey: string;
    readonly models: readonly CompatibleListedModel[];
    readonly preserveDefaultModel?: boolean;
  },
): void {
  const providerId = options.providerId;
  const source: CompatibleEndpointSource = {
    kind: 'compatibleEndpoint',
    protocol: options.protocol,
    displayName: options.displayName,
  };
  const existingProvider = isRecord(config.providers[providerId])
    ? config.providers[providerId]
    : {};
  config.providers[providerId] = {
    ...existingProvider,
    type: options.protocol,
    baseUrl: normalizeBaseUrl(options.baseUrl),
    apiKey: options.apiKey,
    source: isCompatibleEndpointSource(existingProvider['source'])
      ? existingProvider['source']
      : source,
  };

  const existingModels = config.models ?? {};
  const upstreamKeys = new Set(options.models.map((model) => `${providerId}/${model.id}`));
  for (const [key, model] of Object.entries(existingModels)) {
    if (isRecord(model) && model['provider'] === providerId && !upstreamKeys.has(key)) {
      delete existingModels[key];
    }
  }

  for (const model of options.models) {
    const aliasKey = `${providerId}/${model.id}`;
    const existing = isRecord(existingModels[aliasKey]) ? existingModels[aliasKey] : {};
    const existingContext = parsePositiveInt(existing['maxContextSize']);
    const remoteAlias: ManagedKimiModelAlias = {
      provider: providerId,
      model: model.id,
      maxContextSize: model.contextLength ?? existingContext ?? COMPATIBLE_ENDPOINT_DEFAULT_MAX_CONTEXT,
      capabilities: model.capabilities === undefined ? ['tool_use'] : [...model.capabilities],
      displayName: model.displayName,
      supportEfforts: model.supportEfforts === undefined ? undefined : [...model.supportEfforts],
      defaultEffort: model.defaultEffort,
    };
    existingModels[aliasKey] = mergeRefreshedModelAlias(
      existing,
      remoteAlias,
      CUSTOM_REGISTRY_MODEL_FIELDS,
    );
  }
  config.models = existingModels;

  if (options.preserveDefaultModel === true) return;
  if (config.defaultModel !== undefined && existingModels[config.defaultModel] !== undefined) return;
  const first = options.models[0];
  if (first !== undefined) {
    config.defaultModel = `${providerId}/${first.id}`;
  }
}

export function removeCompatibleEndpointConfig(
  config: ManagedKimiConfigShape,
  providerId: string,
): void {
  delete config.providers[providerId];
  let removedDefault = false;
  const existingModels = config.models ?? {};
  for (const [key, model] of Object.entries(existingModels)) {
    if (!isRecord(model) || model['provider'] !== providerId) continue;
    delete existingModels[key];
    if (config.defaultModel === key) removedDefault = true;
  }
  config.models = existingModels;
  if (removedDefault) config.defaultModel = undefined;
}
