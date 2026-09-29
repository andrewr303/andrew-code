import { isolatedAuthPath, readIsolatedApiKey, writeIsolatedApiKey } from './isolated-auth';
import type { ManagedKimiConfigShape } from './managed-kimi-code';
import {
  XAI_OAUTH_API_BASE_URL,
  XAI_OAUTH_STORAGE_KEY,
  xaiOAuthRequestHeaders,
} from './xai-oauth';

export const XAI_PROVIDER_NAME = 'xai';
export const XAI_API_BASE_URL = 'https://api.x.ai/v1';

export interface XaiCatalogModel {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindow: number;
  readonly defaultEffort?: string;
  readonly supportEfforts: readonly string[];
}

export const EMBEDDED_XAI_MODELS: readonly XaiCatalogModel[] = [
  {
    id: 'grok-4.5',
    displayName: 'Grok 4.5',
    contextWindow: 500_000,
    defaultEffort: 'high',
    supportEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'grok-4',
    displayName: 'Grok 4',
    contextWindow: 256_000,
    defaultEffort: 'high',
    supportEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'grok-3',
    displayName: 'Grok 3',
    contextWindow: 131_072,
    defaultEffort: 'high',
    supportEfforts: ['low', 'medium', 'high'],
  },
];

export function xaiApiKey(homeDir?: string): string | undefined {
  return readIsolatedApiKey('xai', homeDir) ?? process.env['XAI_API_KEY']?.trim();
}

export function saveXaiApiKey(apiKey: string, homeDir?: string): void {
  writeIsolatedApiKey('xai', apiKey, homeDir);
}

export function clearXaiApiKey(homeDir?: string): void {
  writeIsolatedApiKey('xai', undefined, homeDir);
}

export function applyXaiConfig(
  config: ManagedKimiConfigShape,
  apiKey: string,
  selectedModelId?: string,
): void {
  const selected = EMBEDDED_XAI_MODELS.find((model) => model.id === selectedModelId) ?? EMBEDDED_XAI_MODELS[0];
  if (selected === undefined) return;
  config.providers[XAI_PROVIDER_NAME] = {
    type: 'openai_responses',
    baseUrl: XAI_API_BASE_URL,
    apiKey,
  };
  applyXaiModels(config, selected.id);
}

export function applyXaiOAuthConfig(
  config: ManagedKimiConfigShape,
  selectedModelId?: string,
): void {
  const selected =
    EMBEDDED_XAI_MODELS.find((model) => model.id === selectedModelId) ??
    EMBEDDED_XAI_MODELS[0];
  if (selected === undefined) return;
  const { Authorization: _authorization, ...customHeaders } = xaiOAuthRequestHeaders({
    accessToken: 'unused',
  });
  config.providers[XAI_PROVIDER_NAME] = {
    type: 'openai',
    baseUrl: XAI_OAUTH_API_BASE_URL,
    oauth: { storage: 'file', key: XAI_OAUTH_STORAGE_KEY },
    customHeaders,
  };
  applyXaiModels(config, selected.id);
}

function applyXaiModels(config: ManagedKimiConfigShape, selectedModelId: string): void {
  const nextModels = { ...config.models };
  for (const key of Object.keys(nextModels)) {
    if (nextModels[key]?.provider === XAI_PROVIDER_NAME) delete nextModels[key];
  }
  for (const model of EMBEDDED_XAI_MODELS) {
    nextModels[model.id] = {
      provider: XAI_PROVIDER_NAME,
      model: model.id,
      maxContextSize: model.contextWindow,
      displayName: model.displayName,
      capabilities: ['thinking', 'tool_use'],
      supportEfforts: [...model.supportEfforts],
      defaultEffort: model.defaultEffort,
    };
  }
  config.models = nextModels;
  if (config.defaultModel === undefined || nextModels[config.defaultModel] === undefined) {
    config.defaultModel = selectedModelId;
  }
}

export function removeXaiConfig(config: ManagedKimiConfigShape): void {
  delete config.providers[XAI_PROVIDER_NAME];
  if (config.models === undefined) return;
  for (const key of Object.keys(config.models)) {
    if (config.models[key]?.provider === XAI_PROVIDER_NAME) delete config.models[key];
  }
}

export { isolatedAuthPath };
