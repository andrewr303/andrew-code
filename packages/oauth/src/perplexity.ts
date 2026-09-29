import { readIsolatedApiKey, writeIsolatedApiKey } from './isolated-auth';
import type { ManagedKimiConfigShape } from './managed-kimi-code';
import { canUsePerplexityFallback, type ProviderProfile } from './provider-profiles';

export const PERPLEXITY_SEARCH_URL = 'https://api.perplexity.ai/search';

export interface PerplexitySearchHit {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
  readonly date?: string;
}

export function perplexityApiKey(homeDir?: string): string | undefined {
  return readIsolatedApiKey('perplexity', homeDir) ?? process.env['PERPLEXITY_API_KEY']?.trim();
}

export function savePerplexityApiKey(apiKey: string, homeDir?: string): void {
  writeIsolatedApiKey('perplexity', apiKey, homeDir);
}

export function clearPerplexityApiKey(homeDir?: string): void {
  writeIsolatedApiKey('perplexity', undefined, homeDir);
}

export function shouldUsePerplexitySearch(profile: ProviderProfile, enabled: boolean): boolean {
  return enabled && canUsePerplexityFallback(profile) && perplexityApiKey() !== undefined;
}

export const PERPLEXITY_PROVIDER_NAME = 'perplexity';

export interface PerplexityCatalogModel {
  readonly id: string;
  readonly displayName: string;
  readonly maxContextSize: number;
}

// Approximate upstream context windows (Jul 2026 sidecar catalog). These are
// conservative estimates, not measured limits — refresh from the sidecar's
// `GET /v1/models` output if the vendored catalog changes.
export const EMBEDDED_PERPLEXITY_MODELS: readonly PerplexityCatalogModel[] = [
  { id: 'perplexity-auto', displayName: 'Perplexity Auto (best)', maxContextSize: 200_000 },
  { id: 'gpt-5.6-terra', displayName: 'GPT-5.6 Terra', maxContextSize: 256_000 },
  { id: 'gpt-5.6-sol', displayName: 'GPT-5.6 Sol', maxContextSize: 256_000 },
  { id: 'grok-4.5', displayName: 'Grok 4.5', maxContextSize: 256_000 },
  { id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', maxContextSize: 200_000 },
  { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', maxContextSize: 200_000 },
  { id: 'gemini-3.1-pro', displayName: 'Gemini 3.1 Pro', maxContextSize: 128_000 },
  { id: 'glm-5.2', displayName: 'GLM 5.2', maxContextSize: 128_000 },
  { id: 'kimi-k2.6', displayName: 'Kimi K2.6', maxContextSize: 256_000 },
  { id: 'nemotron-3-ultra', displayName: 'Nemotron 3 Ultra', maxContextSize: 128_000 },
  { id: 'perplexity-sonar', displayName: 'Perplexity Sonar 2', maxContextSize: 128_000 },
  {
    id: 'perplexity-research',
    displayName: 'Perplexity Deep Research (monthly quota)',
    maxContextSize: 128_000,
  },
];

function normalizePerplexityBaseUrl(baseUrl: string): string {
  // The Anthropic transport appends `/v1/messages` itself (Claude Code
  // convention: base URL carries no `/v1` suffix), so strip it when present.
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/, '');
}

export function applyPerplexityConfig(
  config: ManagedKimiConfigShape,
  baseUrl: string,
  selectedModelId?: string,
): void {
  const selected =
    EMBEDDED_PERPLEXITY_MODELS.find((model) => model.id === selectedModelId) ??
    EMBEDDED_PERPLEXITY_MODELS[0];
  if (selected === undefined) return;
  config.providers[PERPLEXITY_PROVIDER_NAME] = {
    type: 'anthropic',
    baseUrl: normalizePerplexityBaseUrl(baseUrl),
    apiKey: 'perplexity',
  };
  applyPerplexityModels(config, selected.id);
}

function applyPerplexityModels(config: ManagedKimiConfigShape, selectedModelId: string): void {
  const nextModels = { ...config.models };
  for (const key of Object.keys(nextModels)) {
    if (nextModels[key]?.provider === PERPLEXITY_PROVIDER_NAME) delete nextModels[key];
  }
  // Namespaced keys (`perplexity/<id>`, like open-platform): bare ids such as
  // `gpt-5.6-sol` belong to other providers (e.g. codex) and must not be clobbered.
  for (const model of EMBEDDED_PERPLEXITY_MODELS) {
    nextModels[`${PERPLEXITY_PROVIDER_NAME}/${model.id}`] = {
      provider: PERPLEXITY_PROVIDER_NAME,
      model: model.id,
      maxContextSize: model.maxContextSize,
      displayName: model.displayName,
      capabilities: ['thinking', 'tool_use'],
      toolMode: 'code_mode_only',
    };
  }
  config.models = nextModels;
  const selectedKey = `${PERPLEXITY_PROVIDER_NAME}/${selectedModelId}`;
  if (config.defaultModel === undefined || nextModels[config.defaultModel] === undefined) {
    config.defaultModel = selectedKey;
  }
}

export function removePerplexityConfig(config: ManagedKimiConfigShape): void {
  delete config.providers[PERPLEXITY_PROVIDER_NAME];
  if (config.models === undefined) return;
  for (const key of Object.keys(config.models)) {
    if (config.models[key]?.provider === PERPLEXITY_PROVIDER_NAME) delete config.models[key];
  }
}

export async function searchPerplexity(options: {
  readonly query: string;
  readonly allowedDomains?: readonly string[];
  readonly apiKey?: string;
  readonly fetchImpl?: typeof fetch;
}): Promise<readonly PerplexitySearchHit[]> {
  const apiKey = options.apiKey ?? perplexityApiKey();
  if (apiKey === undefined) {
    throw new Error('Perplexity search is not configured. Add a key in Settings.');
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const body: Record<string, unknown> = { query: options.query };
  if (options.allowedDomains !== undefined && options.allowedDomains.length > 0) {
    body['search_domain_filter'] = [...options.allowedDomains];
  }
  const response = await fetchImpl(PERPLEXITY_SEARCH_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Perplexity search returned ${String(response.status)}`);
  }
  const payload: unknown = await response.json();
  return parseHits(payload);
}

function parseHits(payload: unknown): PerplexitySearchHit[] {
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const results = Array.isArray(record['results'])
    ? record['results']
    : Array.isArray(payload)
      ? payload
      : [];
  const hits: PerplexitySearchHit[] = [];
  for (const item of results) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const url = typeof row['url'] === 'string' ? row['url'] : undefined;
    if (url === undefined) continue;
    hits.push({
      title: typeof row['title'] === 'string' ? row['title'] : url,
      url,
      snippet:
        typeof row['snippet'] === 'string'
          ? row['snippet']
          : typeof row['content'] === 'string'
            ? row['content']
            : '',
      date: typeof row['date'] === 'string' ? row['date'] : undefined,
    });
  }
  return hits;
}
