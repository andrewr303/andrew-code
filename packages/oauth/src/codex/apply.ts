import { CODEX_PROVIDER_NAME, inferenceBaseUrl } from './constants';
import type { CodexCatalogModel } from './catalog';
import { requestAuthHeaders, type CodexCredentials } from './store';
import type { ManagedKimiConfigShape } from '../managed-kimi-code';
import { isRecord } from '../utils';

export const CODEX_OAUTH_STORAGE_KEY = 'codex';

export function applyCodexConfig(
  config: ManagedKimiConfigShape,
  models: readonly CodexCatalogModel[],
  selectedModelId?: string,
): void {
  const selected = models.find((model) => model.id === selectedModelId) ?? models[0];
  if (selected === undefined) return;

  const existingProvider = isRecord(config.providers[CODEX_PROVIDER_NAME])
    ? config.providers[CODEX_PROVIDER_NAME]
    : {};
  config.providers[CODEX_PROVIDER_NAME] = {
    ...existingProvider,
    type: 'openai_responses',
    baseUrl: inferenceBaseUrl(),
    oauth: { storage: 'file', key: CODEX_OAUTH_STORAGE_KEY },
  };

  const nextModels = { ...config.models };
  for (const key of Object.keys(nextModels)) {
    if (nextModels[key]?.provider === CODEX_PROVIDER_NAME) {
      delete nextModels[key];
    }
  }
  for (const model of models) {
    nextModels[model.id] = {
      provider: CODEX_PROVIDER_NAME,
      model: model.id,
      maxContextSize: model.contextWindow,
      displayName: model.displayName,
      capabilities: ['thinking', 'always_thinking', 'tool_use'],
      supportEfforts: model.reasoningEfforts.map((effort) => effort.value),
      defaultEffort: model.defaultEffort,
    };
  }
  config.models = nextModels;
  if (config.defaultModel === undefined || nextModels[config.defaultModel] === undefined) {
    config.defaultModel = selected.id;
  }
}

export function applyCodexAuthHeaders(
  config: ManagedKimiConfigShape,
  credentials: CodexCredentials,
): void {
  const provider = config.providers[CODEX_PROVIDER_NAME];
  if (provider === undefined) return;
  const { Authorization: _authorization, ...customHeaders } = requestAuthHeaders(credentials);
  config.providers[CODEX_PROVIDER_NAME] = { ...provider, customHeaders };
}

export function removeCodexConfig(config: ManagedKimiConfigShape): void {
  delete config.providers[CODEX_PROVIDER_NAME];
  if (config.models === undefined) return;
  for (const key of Object.keys(config.models)) {
    if (config.models[key]?.provider === CODEX_PROVIDER_NAME) {
      delete config.models[key];
    }
  }
  if (config.defaultModel !== undefined && config.models[config.defaultModel] === undefined) {
    config.defaultModel = Object.keys(config.models)[0];
  }
}
