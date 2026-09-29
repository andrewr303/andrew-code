import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveAndrewHome } from '../home';
import { isRecord } from '../utils';
import {
  backendBaseUrl,
  CODEX_MODELS_CACHE_FILE_NAME,
  CODEX_MODELS_CACHE_TTL_MS,
  CODEX_MODELS_REQUEST_TIMEOUT_MS,
  codexClientVersion,
} from './constants';
import { requestAuthHeaders, type CodexCredentials } from './store';
import type { CodeMode } from '../provider-profiles';

export interface CodexCatalogEffort {
  readonly value: string;
  readonly description?: string;
  readonly default?: boolean;
}

export interface CodexCatalogModel {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly contextWindow: number;
  readonly toolMode: CodeMode;
  readonly multiAgentVersion?: string;
  readonly supportsBackendSearch: boolean;
  readonly reasoningEfforts: readonly CodexCatalogEffort[];
  readonly defaultEffort?: string;
  readonly autoCompactTokenLimit?: number;
  readonly compHash?: string;
  readonly reasoningSummary?: 'none' | 'auto' | 'concise' | 'detailed';
}

export const EMBEDDED_CODEX_MODELS: readonly CodexCatalogModel[] = [
  {
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    description: 'Latest frontier agentic coding model',
    contextWindow: 353_000,
    toolMode: 'code_mode_only',
    multiAgentVersion: 'v2',
    supportsBackendSearch: true,
    defaultEffort: 'low',
    reasoningEfforts: [
      { value: 'low', description: 'Fast responses with lighter reasoning', default: true },
      { value: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
      { value: 'high', description: 'Greater reasoning depth for complex problems' },
      { value: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
      { value: 'max', description: 'Maximum reasoning depth for the hardest problems' },
      { value: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
    ],
  },
  {
    id: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    description: 'Balanced agentic coding model for everyday work',
    contextWindow: 353_000,
    toolMode: 'code_mode_only',
    multiAgentVersion: 'v2',
    supportsBackendSearch: true,
    defaultEffort: 'medium',
    reasoningEfforts: [
      { value: 'low', description: 'Fast responses with lighter reasoning' },
      { value: 'medium', description: 'Balances speed and reasoning depth for everyday tasks', default: true },
      { value: 'high', description: 'Greater reasoning depth for complex problems' },
      { value: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
      { value: 'max', description: 'Maximum reasoning depth for the hardest problems' },
      { value: 'ultra', description: 'Maximum reasoning with automatic task delegation' },
    ],
  },
  {
    id: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    description: 'Fast and affordable agentic coding model',
    contextWindow: 353_000,
    toolMode: 'code_mode_only',
    multiAgentVersion: 'v1',
    supportsBackendSearch: true,
    defaultEffort: 'medium',
    reasoningEfforts: [
      { value: 'low', description: 'Fast responses with lighter reasoning' },
      { value: 'medium', description: 'Balances speed and reasoning depth for everyday tasks', default: true },
      { value: 'high', description: 'Greater reasoning depth for complex problems' },
      { value: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
      { value: 'max', description: 'Maximum reasoning depth for the hardest problems' },
    ],
  },
];

export interface CodexCatalogResult {
  readonly models: readonly CodexCatalogModel[];
  readonly source: 'live' | 'cache' | 'embedded';
}

export function embedCodexModels(): readonly CodexCatalogModel[] {
  return EMBEDDED_CODEX_MODELS;
}

export function mapCodexWireEffort(effort: string): string {
  return effort === 'ultra' ? 'max' : effort;
}

export function ultraEnablesProactive(model: CodexCatalogModel, effort: string): boolean {
  return effort === 'ultra' && model.multiAgentVersion === 'v2';
}

export async function fetchCodexCatalog(options: {
  readonly credentials: CodexCredentials;
  readonly homeDir?: string;
  readonly fetchImpl?: typeof fetch;
  /**
   * Skip the on-disk cache and force a live fetch. Login flows should pass
   * `true` so a re-login always re-pings the endpoint instead of replaying a
   * stale 5-minute cache written by an older client version.
   */
  readonly forceRefresh?: boolean;
}): Promise<CodexCatalogResult> {
  const cache = readCache(options.homeDir);
  const version = codexClientVersion();
  const endpoint = `${backendBaseUrl().replace(/\/+$/, '')}/codex/models?client_version=${encodeURIComponent(version)}`;
  if (
    options.forceRefresh !== true &&
    cache !== undefined &&
    cacheIsFresh(cache, options.credentials, version, endpoint)
  ) {
    return { models: cache.models, source: 'cache' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CODEX_MODELS_REQUEST_TIMEOUT_MS);
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(endpoint, {
      headers: {
        ...requestAuthHeaders(options.credentials),
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      return fallback(cache);
    }
    const payload: unknown = await response.json();
    const live = parseLiveCatalog(payload);
    const visible = live.filter((model) => model !== undefined);
    const models = visible.length > 0 ? visible : [...EMBEDDED_CODEX_MODELS];
    writeCache(options.homeDir, {
      fetchedAt: Date.now(),
      clientVersion: version,
      endpoint,
      accountId: options.credentials.accountId,
      models,
    });
    return { models, source: visible.length > 0 ? 'live' : 'embedded' };
  } catch {
    return fallback(cache);
  } finally {
    clearTimeout(timer);
  }
}

interface CacheFile {
  readonly fetchedAt: number;
  readonly clientVersion: string;
  readonly endpoint: string;
  readonly accountId?: string;
  readonly models: readonly CodexCatalogModel[];
}

function fallback(cache: CacheFile | undefined): CodexCatalogResult {
  if (
    cache !== undefined &&
    cache.models.some((model) => model.reasoningEfforts.length > 0)
  ) {
    return { models: cache.models, source: 'cache' };
  }
  return { models: EMBEDDED_CODEX_MODELS, source: 'embedded' };
}

function cacheIsFresh(
  cache: CacheFile,
  credentials: CodexCredentials,
  version: string,
  endpoint: string,
): boolean {
  if (Date.now() - cache.fetchedAt > CODEX_MODELS_CACHE_TTL_MS) return false;
  if (cache.clientVersion !== version) return false;
  if (cache.endpoint !== endpoint) return false;
  if ((cache.accountId ?? '') !== (credentials.accountId ?? '')) return false;
  return (
    cache.models.length > 0 &&
    cache.models.some((model) => model.reasoningEfforts.length > 0)
  );
}

function cachePath(homeDir?: string): string {
  return join(resolveAndrewHome(homeDir), CODEX_MODELS_CACHE_FILE_NAME);
}

function readCache(homeDir?: string): CacheFile | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(cachePath(homeDir), 'utf8'));
    if (!isRecord(parsed) || !Array.isArray(parsed['models'])) return undefined;
    return parsed as unknown as CacheFile;
  } catch {
    return undefined;
  }
}

function writeCache(homeDir: string | undefined, cache: CacheFile): void {
  const path = cachePath(homeDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cache, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows
  }
  renameSync(tmp, path);
}

function parseLiveCatalog(payload: unknown): CodexCatalogModel[] {
  const items = extractItems(payload);
  const models: CodexCatalogModel[] = [];
  for (const item of items) {
    const parsed = parseLiveModel(item);
    if (parsed !== undefined) models.push(parsed);
  }
  return models;
}

function extractItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  if (Array.isArray(payload['data'])) return payload['data'];
  if (Array.isArray(payload['models'])) return payload['models'];
  if (Array.isArray(payload['items'])) return payload['items'];
  return [];
}

function parseLiveModel(item: unknown): CodexCatalogModel | undefined {
  if (!isRecord(item)) return undefined;
  const visibility = typeof item['visibility'] === 'string' ? item['visibility'].toLowerCase() : 'list';
  if (visibility === 'hide' || visibility === 'hidden') return undefined;
  const id = readString(item['id']) ?? readString(item['slug']) ?? readString(item['model']);
  if (id === undefined) return undefined;
  const context =
    readPositiveInt(item['context_window']) ??
    readPositiveInt(item['effective_context_window']) ??
    353_000;
  const toolMode = parseToolMode(item['tool_mode']);
  const efforts = parseEfforts(
    item['reasoning_efforts'] ??
      item['supported_reasoning_efforts'] ??
      item['supported_reasoning_levels'],
  );
  const defaultEffort =
    efforts.find((effort) => effort.default === true)?.value ??
    readString(item['default_reasoning_effort']) ??
    readString(item['default_reasoning_level']) ??
    efforts[0]?.value;
  return {
    id,
    displayName: readString(item['name']) ?? readString(item['display_name']) ?? id,
    description: readString(item['description']),
    contextWindow: context,
    toolMode,
    multiAgentVersion: readString(item['multi_agent_version']),
    supportsBackendSearch: item['supports_backend_search'] !== false,
    reasoningEfforts: efforts,
    defaultEffort,
    autoCompactTokenLimit: readPositiveInt(item['auto_compact_token_limit']),
    compHash: readString(item['comp_hash']),
    reasoningSummary: parseSummary(item['reasoning_summary'] ?? item['default_reasoning_summary']),
  };
}

function parseToolMode(value: unknown): CodeMode {
  if (value === 'code_mode_only') return 'code_mode_only';
  if (value === 'code_mode') return 'code_mode';
  return 'direct';
}

function parseSummary(value: unknown): 'none' | 'auto' | 'concise' | 'detailed' | undefined {
  if (value === 'none' || value === 'auto' || value === 'concise' || value === 'detailed') {
    return value;
  }
  return undefined;
}

function parseEfforts(value: unknown): CodexCatalogEffort[] {
  if (!Array.isArray(value)) return [];
  const out: CodexCatalogEffort[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      out.push({ value: item });
      continue;
    }
    if (!isRecord(item)) continue;
    const name = readString(item['value']) ?? readString(item['effort']);
    if (name === undefined) continue;
    out.push({
      value: name,
      description: readString(item['description']),
      default: item['default'] === true,
    });
  }
  return out;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readPositiveInt(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}
