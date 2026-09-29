import {
  applyCompatibleEndpointConfig,
  applyCustomRegistryEntries,
  applyQwenTokenPlanConfig,
  assertUsableProviderId,
  fetchCompatibleEndpointModels,
  fetchCustomRegistry,
  fetchQwenTokenPlanModels,
  slugifyProviderId,
  type CompatibleEndpointProtocol,
  type CustomRegistrySource,
  type ManagedKimiConfigShape,
  type QwenTokenPlanProtocol,
} from '@moonshot-ai/kimi-code-oauth';
import {
  applyCatalogProvider,
  catalogProviderModels,
  CatalogFetchError,
  DEFAULT_CATALOG_URL,
  resolveCatalogImport,
  type Catalog,
  type ThinkingEffort,
} from '@moonshot-ai/kimi-code-sdk';

import { createKimiCodeUserAgent } from '#/cli/version';
import { fetchCatalogOrBuiltIn } from '#/utils/catalog-fetch';
import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import {
  CustomEndpointImportDialogComponent,
  type CustomEndpointImportResult,
} from '../components/dialogs/custom-endpoint-import';
import {
  CustomRegistryImportDialogComponent,
  type CustomRegistryImportResult,
} from '../components/dialogs/custom-registry-import';
import {
  ProviderManagerComponent,
  type ProviderManagerOptions,
} from '../components/dialogs/provider-manager';
import { TabbedModelSelectorComponent } from '../components/dialogs/tabbed-model-selector';
import { DEFAULT_OAUTH_PROVIDER_NAME } from '../constant/kimi-tui';
import { formatErrorMessage } from '../utils/event-payload';
import { thinkingEffortToConfig } from '../utils/thinking-config';
import { effectiveModelForHost } from './config';
import {
  promptApiKey,
  promptBaseUrl,
  promptCatalogProviderSelection,
} from './prompts';
import type { SlashCommandHost } from './dispatch';

type ProviderAddSource =
  | 'known'
  | 'qwen'
  | 'openai-endpoint'
  | 'anthropic-endpoint'
  | 'custom';

const CONFIG_SAVE_HINT = 'Your key will be saved to ~/.andrewcode/config.toml';

// ---------------------------------------------------------------------------
// /provider command
// ---------------------------------------------------------------------------

export async function handleProviderCommand(host: SlashCommandHost): Promise<void> {
  const options = buildProviderManagerOptions(host);
  const component = new ProviderManagerComponent(options);
  host.mountEditorReplacement(component);
}

function buildProviderManagerOptions(host: SlashCommandHost): ProviderManagerOptions {
  const activeProviderId =
    host.state.appState.availableModels[host.state.appState.model]?.provider;
  return {
    providers: host.state.appState.availableProviders,
    activeProviderId,
    onAdd: () => {
      void handleProviderAdd(host).catch((error: unknown) => {
        host.showError(`Add provider failed: ${formatErrorMessage(error)}`);
      });
    },
    onRefresh: () => {
      void handleProviderRefresh(host).catch((error: unknown) => {
        host.showError(`Refresh providers failed: ${formatErrorMessage(error)}`);
      });
    },
    onDeleteSource: (providerIds) => {
      void handleProviderManagerDeleteSource(host, providerIds).catch((error: unknown) => {
        host.showError(`Remove provider failed: ${formatErrorMessage(error)}`);
      });
    },
    onClose: () => {
      host.restoreEditor();
    },
  };
}

async function handleProviderManagerDeleteSource(
  host: SlashCommandHost,
  providerIds: readonly string[],
): Promise<void> {
  for (const providerId of providerIds) {
    try {
      await handleProviderDelete(host, providerId);
    } catch (error) {
      const msg = formatErrorMessage(error);
      host.showError(`Failed to delete provider ${providerId}: ${msg}`);
    }
  }
  reopenProviderManager(host);
}

async function handleProviderDelete(host: SlashCommandHost, providerId: string): Promise<void> {
  if (providerId === DEFAULT_OAUTH_PROVIDER_NAME) {
    await host.harness.auth.logout(DEFAULT_OAUTH_PROVIDER_NAME);
    await host.authFlow.refreshConfigAfterLogout();
    await host.authFlow.clearActiveSessionAfterLogout();
    return;
  }

  const activeProvider =
    host.state.appState.availableModels[host.state.appState.model]?.provider;
  const config = await host.harness.removeProvider(providerId);
  if (activeProvider === providerId) {
    await host.authFlow.refreshConfigAfterLogout();
    await host.authFlow.clearActiveSessionAfterLogout();
  } else {
    host.setAppState({
      availableProviders: config.providers ?? {},
      availableModels: config.models ?? {},
    });
  }
}

async function handleProviderAdd(host: SlashCommandHost): Promise<void> {
  const source = await promptProviderAddSource(host);
  if (source === undefined) {
    reopenProviderManager(host);
    return;
  }

  if (source === 'known') {
    await handleCatalogProviderAdd(host);
    return;
  }
  if (source === 'qwen') {
    const handled = await handleQwenTokenPlanAdd(host);
    if (!handled) reopenProviderManager(host);
    return;
  }
  if (source === 'openai-endpoint' || source === 'anthropic-endpoint') {
    const handled = await handleCompatibleEndpointAdd(
      host,
      source === 'anthropic-endpoint' ? 'anthropic' : 'openai',
    );
    if (!handled) reopenProviderManager(host);
    return;
  }
  const handled = await handleCustomRegistryAddViaDialog(host);
  if (!handled) {
    reopenProviderManager(host);
  }
}

function reopenProviderManager(host: SlashCommandHost): void {
  const options = buildProviderManagerOptions(host);
  const component = new ProviderManagerComponent(options);
  host.mountEditorReplacement(component);
}

function promptProviderAddSource(
  host: SlashCommandHost,
): Promise<ProviderAddSource | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title: 'Add provider',
      options: [
        { value: 'qwen', label: 'QwenCloud Token Plan' },
        { value: 'openai-endpoint', label: 'Custom OpenAI-compatible endpoint' },
        { value: 'anthropic-endpoint', label: 'Custom Anthropic-compatible endpoint' },
        { value: 'known', label: 'Known third-party provider' },
        { value: 'custom', label: 'Custom registry (api.json)' },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        resolve(isProviderAddSource(value) ? value : undefined);
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

function isProviderAddSource(value: string): value is ProviderAddSource {
  return (
    value === 'known' ||
    value === 'qwen' ||
    value === 'openai-endpoint' ||
    value === 'anthropic-endpoint' ||
    value === 'custom'
  );
}

async function handleProviderRefresh(host: SlashCommandHost): Promise<void> {
  const spinner = host.showLoginProgressSpinner('Refreshing models from every configured provider');
  try {
    const result = await host.authFlow.refreshProviderModels();
    const changedCount = result.changed.reduce((sum, change) => sum + change.added, 0);
    const removedCount = result.changed.reduce((sum, change) => sum + change.removed, 0);
    const parts: string[] = [];
    if (result.changed.length > 0) {
      parts.push(
        `${String(result.changed.length)} provider${result.changed.length === 1 ? '' : 's'} updated`,
      );
    }
    if (changedCount > 0) parts.push(`+${String(changedCount)} models`);
    if (removedCount > 0) parts.push(`-${String(removedCount)} models`);
    if (result.failed.length > 0) {
      parts.push(`${String(result.failed.length)} failed`);
    }
    spinner.stop({
      ok: result.failed.length === 0,
      label:
        parts.length === 0
          ? 'Model lists are already up to date.'
          : `Refresh complete: ${parts.join(', ')}.`,
    });
    for (const failure of result.failed) {
      host.showStatus(`Skipped ${failure.provider}: ${failure.reason}`, 'warning');
    }
  } catch (error) {
    spinner.stop({ ok: false, label: 'Refresh failed.' });
    host.showError(`Failed to refresh providers: ${formatErrorMessage(error)}`);
  }
  reopenProviderManager(host);
}

async function handleCatalogProviderAdd(host: SlashCommandHost): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancel;

  const spinner = host.showLoginProgressSpinner(`Fetching catalog from ${DEFAULT_CATALOG_URL}`);
  let catalog: Catalog | undefined;
  try {
    const loaded = await fetchCatalogOrBuiltIn(DEFAULT_CATALOG_URL, {
      signal: controller.signal,
      userAgent: createKimiCodeUserAgent(),
    });
    catalog = loaded.catalog;
    spinner.stop({
      ok: true,
      label: loaded.fromBuiltIn
        ? 'Catalog loaded from built-in snapshot (models.dev unreachable).'
        : 'Catalog loaded.',
    });
  } catch (error) {
    if (controller.signal.aborted) {
      spinner.stop({ ok: false, label: 'Aborted.' });
    } else {
      const hint = error instanceof CatalogFetchError ? ` (HTTP ${error.status})` : '';
      spinner.stop({ ok: false, label: 'Failed to load catalog.' });
      host.showError(`Failed to fetch catalog${hint}: ${formatErrorMessage(error)}`);
    }
  } finally {
    if (host.cancelInFlight === cancel) host.cancelInFlight = undefined;
  }

  if (catalog === undefined) return;

  const providerId = await promptCatalogProviderSelection(host, catalog);
  if (providerId === undefined) return;
  const entry = catalog[providerId];
  if (entry === undefined) return;

  const models = catalogProviderModels(entry);
  if (models.length === 0) {
    host.showError(`Provider "${providerId}" has no usable models in this catalog.`);
    return;
  }

  let resolution = resolveCatalogImport(entry);
  if (resolution.kind === 'needs-base-url') {
    const entered = await promptBaseUrl(host, entry.name ?? providerId);
    if (entered === undefined) return;
    resolution = resolveCatalogImport(entry, entered);
  }
  if (resolution.kind !== 'ok') {
    if (resolution.kind === 'invalid') {
      if (resolution.reason === 'unknown-explicit-type') {
        host.showError(
          `Provider "${providerId}" declares protocol "${entry.type}" in the catalog, which this client version does not support.`,
        );
      } else if (resolution.reason === 'proprietary-sdk') {
        host.showError(
          `Provider "${providerId}" uses a proprietary SDK this client cannot speak (e.g. Amazon Bedrock or Cohere); it cannot be imported from the catalog.`,
        );
      } else {
        host.showError(
          `Base URL contains an env placeholder or is empty. Enter the resolved URL instead.`,
        );
      }
    }
    return;
  }
  const { wire, baseUrl } = resolution;

  const apiKey = await promptApiKey(host, entry.name ?? providerId);
  if (apiKey === undefined) return;

  // Persist the provider and all its models immediately after the api key is
  // entered. The model selector that follows is just a convenience to pick the
  // default model; ESC leaves the provider in place without a default selection.
  const existingConfig = await host.harness.getConfig();
  if (existingConfig.providers[providerId] !== undefined) {
    await host.harness.removeProvider(providerId);
  }

  const config = await host.harness.getConfig();
  applyCatalogProvider(config, {
    providerId,
    wire,
    baseUrl,
    apiKey,
    models,
    selectedModelId: '', // no default yet; user picks in the model selector
    thinking: false,    // will be resolved by the model selector
  });

  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: providerId, method: 'catalog' });
  host.showStatus(`Provider added: ${entry.name ?? providerId}`);
  if (resolution.guessed) {
    host.showStatus(
      `Protocol guessed as "openai" for ${providerId} — edit "type" in config.toml if requests fail.`,
    );
  }

  // Build a merged model dictionary that includes existing models plus the
  // newly-persisted provider's models, so the tabbed selector shows every
  // provider's tab (the new provider's tab starts active via initialTabId).
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});
  const mergedModels = { ...stateModels };

  const selector = new TabbedModelSelectorComponent({
    models: mergedModels,
    currentValue: host.state.appState.model,
    selectedValue: Object.keys(mergedModels).find((a) => a.startsWith(`${providerId}/`)),
    currentThinkingEffort: host.state.appState.thinkingEffort,
    initialTabId: providerId,
    onSelect: ({ alias, thinking }) => {
      host.restoreEditor();
      void setDefaultModel(host, alias, thinking).catch((error: unknown) => {
        host.showError(`Set default model failed: ${formatErrorMessage(error)}`);
      });
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(selector);
}

async function setDefaultModel(
  host: SlashCommandHost,
  alias: string,
  effort: ThinkingEffort,
): Promise<void> {
  // Resolve efforts the same way the /model path does (effectiveModelForHost
  // applies overrides and the protocol-profile inference): catalog entries for
  // e.g. Anthropic models declare no support_efforts on the alias, and without
  // the inference a top-tier pick would slip through as a persisted effort.
  const model = host.state.appState.availableModels[alias];
  await host.harness.setConfig({
    defaultModel: alias,
    thinking: thinkingEffortToConfig(
      effort,
      model === undefined ? undefined : effectiveModelForHost(host, model).supportEfforts,
    ),
  });
  await host.authFlow.refreshConfigAfterLogin();
  host.track('model_switch', { model: alias });
  host.showStatus(`Default model set to ${alias} with thinking ${effort}.`);
}

async function handleQwenTokenPlanAdd(host: SlashCommandHost): Promise<boolean> {
  const protocol = await promptQwenProtocol(host);
  if (protocol === undefined) return false;

  const apiKey = await promptApiKey(host, 'QwenCloud Token Plan', [
    'Use a Token Plan key (sk-sp-…). Pay-as-you-go keys will not work.',
    CONFIG_SAVE_HINT,
  ]);
  if (apiKey === undefined) return false;

  const spinner = host.showLoginProgressSpinner('Fetching QwenCloud Token Plan models');
  let models: Awaited<ReturnType<typeof fetchQwenTokenPlanModels>>;
  try {
    models = await fetchQwenTokenPlanModels({ protocol, apiKey });
    spinner.stop({
      ok: true,
      label: `Loaded ${String(models.length)} model${models.length === 1 ? '' : 's'}.`,
    });
  } catch (error) {
    spinner.stop({ ok: false, label: 'Failed to list Token Plan models.' });
    host.showError(`Failed to list QwenCloud models: ${formatErrorMessage(error)}`);
    return false;
  }
  if (models.length === 0) {
    host.showError('QwenCloud Token Plan returned no chat models.');
    return false;
  }

  const existingConfig = await host.harness.getConfig();
  const providerId =
    protocol === 'anthropic' ? 'qwen-token-plan-anthropic' : 'qwen-token-plan';
  if (existingConfig.providers[providerId] !== undefined) {
    await host.harness.removeProvider(providerId);
  }
  const config = await host.harness.getConfig();
  applyQwenTokenPlanConfig(config as unknown as ManagedKimiConfigShape, {
    protocol,
    apiKey,
    models,
  });
  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
  });
  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: providerId, method: 'qwen-token-plan' });
  host.showStatus(
    protocol === 'anthropic'
      ? 'Provider added: QwenCloud Token Plan (Anthropic)'
      : 'Provider added: QwenCloud Token Plan (OpenAI Responses)',
  );
  await offerDefaultModelSelector(host, providerId);
  return true;
}

async function handleCompatibleEndpointAdd(
  host: SlashCommandHost,
  protocol: Extract<CompatibleEndpointProtocol, 'openai' | 'anthropic'>,
): Promise<boolean> {
  const value = await promptCompatibleEndpoint(host, protocol);
  if (value === undefined) return false;

  let providerId: string;
  try {
    providerId = slugifyProviderId(value.name);
    assertUsableProviderId(providerId);
  } catch (error) {
    host.showError(formatErrorMessage(error));
    return false;
  }

  const spinner = host.showLoginProgressSpinner(`Listing models at ${value.endpoint}`);
  let models: Awaited<ReturnType<typeof fetchCompatibleEndpointModels>>;
  try {
    models = await fetchCompatibleEndpointModels({
      baseUrl: value.endpoint,
      apiKey: value.apiKey,
      protocol,
    });
    spinner.stop({
      ok: true,
      label: `Loaded ${String(models.length)} model${models.length === 1 ? '' : 's'}.`,
    });
  } catch (error) {
    spinner.stop({ ok: false, label: 'Failed to list models.' });
    host.showError(`Failed to list models: ${formatErrorMessage(error)}`);
    return false;
  }
  if (models.length === 0) {
    host.showError('Endpoint returned no chat models.');
    return false;
  }

  const existingConfig = await host.harness.getConfig();
  if (existingConfig.providers[providerId] !== undefined) {
    await host.harness.removeProvider(providerId);
  }
  const config = await host.harness.getConfig();
  applyCompatibleEndpointConfig(config as unknown as ManagedKimiConfigShape, {
    providerId,
    displayName: value.name,
    protocol,
    baseUrl: value.endpoint,
    apiKey: value.apiKey,
    models,
  });
  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
  });
  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: providerId, method: 'compatible-endpoint' });
  host.showStatus(`Provider added: ${value.name}`);
  await offerDefaultModelSelector(host, providerId);
  return true;
}

function promptQwenProtocol(host: SlashCommandHost): Promise<QwenTokenPlanProtocol | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title: 'QwenCloud Token Plan protocol',
      options: [
        {
          value: 'openai',
          label: 'OpenAI Responses',
          description: 'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1',
        },
        {
          value: 'anthropic',
          label: 'Anthropic Messages',
          description: 'https://token-plan.maas.qwencloudapi.com/apps/anthropic',
        },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        resolve(value === 'anthropic' ? 'anthropic' : value === 'openai' ? 'openai' : undefined);
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

function promptCompatibleEndpoint(
  host: SlashCommandHost,
  protocol: Extract<CompatibleEndpointProtocol, 'openai' | 'anthropic'>,
): Promise<{ readonly name: string; readonly endpoint: string; readonly apiKey: string } | undefined> {
  return new Promise((resolve) => {
    const dialog = new CustomEndpointImportDialogComponent(
      (result: CustomEndpointImportResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
      {
        title:
          protocol === 'anthropic'
            ? 'Add Anthropic-compatible provider'
            : 'Add OpenAI-compatible provider',
        subtitle:
          protocol === 'anthropic'
            ? 'Name, Messages API base URL, and API key. Models are listed from the endpoint.'
            : 'Name, Chat Completions base URL, and API key. Models are listed from /models.',
      },
    );
    host.mountEditorReplacement(dialog);
  });
}

async function offerDefaultModelSelector(host: SlashCommandHost, providerId: string): Promise<void> {
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});
  const firstNewAlias = Object.keys(stateModels).find((alias) => alias.startsWith(`${providerId}/`));
  const selector = new TabbedModelSelectorComponent({
    models: stateModels,
    currentValue: host.state.appState.model,
    selectedValue: firstNewAlias,
    currentThinkingEffort: host.state.appState.thinkingEffort,
    initialTabId: providerId,
    onSelect: ({ alias, thinking }) => {
      host.restoreEditor();
      void setDefaultModel(host, alias, thinking).catch((error: unknown) => {
        host.showError(`Set default model failed: ${formatErrorMessage(error)}`);
      });
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(selector);
}

async function handleCustomRegistryAddViaDialog(host: SlashCommandHost): Promise<boolean> {
  const value = await promptCustomRegistryImport(host);
  if (value === undefined) return false;

  const source: CustomRegistrySource = {
    kind: 'apiJson',
    url: value.url,
    apiKey: value.apiKey,
  };

  let entries: Awaited<ReturnType<typeof fetchCustomRegistry>>;
  try {
    entries = await fetchCustomRegistry(source, { userAgent: createKimiCodeUserAgent() });
  } catch (error) {
    host.showError(`Failed to import registry: ${formatErrorMessage(error)}`);
    return false;
  }

  const addedProviderIds = Object.values(entries).map((entry) => entry.id);
  try {
    const config = await host.harness.getConfig();
    applyCustomRegistryEntries(
      config as unknown as ManagedKimiConfigShape,
      entries,
      source,
    );
    await host.harness.setConfig({
      providers: config.providers,
      models: config.models,
    });
    await host.authFlow.refreshConfigAfterLogin();
  } catch (error) {
    host.showError(`Failed to apply registry: ${formatErrorMessage(error)}`);
    return false;
  }

  const count = addedProviderIds.length;
  if (count === 0) {
    host.showStatus('Registry contained no providers.');
    return false;
  }
  host.showStatus(
    count === 1
      ? 'Imported 1 provider from registry.'
      : `Imported ${String(count)} providers from registry.`,
    'success',
  );

  // Offer the model selector so the user can pick a default, just like the
  // catalog (known-provider) flow.
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});
  const firstNewAlias = Object.keys(stateModels).find((a) =>
    addedProviderIds.some((pid) => a.startsWith(`${pid}/`)),
  );
  const firstNewProvider = firstNewAlias
    ? stateModels[firstNewAlias]?.provider
    : addedProviderIds[0];
  const selector = new TabbedModelSelectorComponent({
    models: stateModels,
    currentValue: host.state.appState.model,
    selectedValue: firstNewAlias,
    currentThinkingEffort: host.state.appState.thinkingEffort,
    initialTabId: firstNewProvider,
    onSelect: ({ alias, thinking }) => {
      host.restoreEditor();
      void setDefaultModel(host, alias, thinking).catch((error: unknown) => {
        host.showError(`Set default model failed: ${formatErrorMessage(error)}`);
      });
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(selector);
  return true;
}

function promptCustomRegistryImport(
  host: SlashCommandHost,
): Promise<{ readonly url: string; readonly apiKey: string } | undefined> {
  return new Promise((resolve) => {
    const dialog = new CustomRegistryImportDialogComponent(
      (result: CustomRegistryImportResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
    );
    host.mountEditorReplacement(dialog);
  });
}
