import {
  applyCodexConfig,
  applyCodexAuthHeaders,
  applyXaiConfig,
  applyXaiOAuthConfig,
  applyOpenPlatformConfig,
  embedCodexModels,
  fetchCodexCatalog,
  filterModelsByPrefix,
  fetchOpenPlatformModels,
  getOpenPlatformById,
  loginCodex,
  loginXai,
  OpenPlatformApiError,
  saveXaiApiKey,
  type ManagedKimiCodeModelInfo,
  type ManagedKimiConfigShape,
  type OpenPlatformDefinition,
} from '@moonshot-ai/kimi-code-oauth';
import { log } from '@moonshot-ai/kimi-code-sdk';

import { openUrl } from '#/utils/open-url';

import type { ChoiceOption } from '../components/dialogs/choice-picker';
import { DEFAULT_OAUTH_PROVIDER_NAME, PRODUCT_NAME } from '../constant/kimi-tui';
import { formatErrorMessage } from '../utils/event-payload';
import type { LoginProgressSpinnerHandle } from '../types';
import {
  promptApiKey,
  promptLogoutProviderSelection,
  promptModelSelectionForOpenPlatform,
  promptPlatformSelection,
} from './prompts';
import type { SlashCommandHost } from './dispatch';

// ---------------------------------------------------------------------------
// Auth: login / logout
// ---------------------------------------------------------------------------

export async function handleLoginCommand(
  host: SlashCommandHost,
  args?: string,
): Promise<void> {
  const trimmed = args?.trim() ?? '';
  if (trimmed.length > 0) {
    const lower = trimmed.toLowerCase();
    if (lower === 'claude') {
      await handleExternalCliLogin(host, 'claude');
      return;
    }
    if (lower === 'perplexity') {
      await handleExternalCliLogin(host, 'perplexity');
      return;
    }
    if (lower === 'codex') {
      await handleNativeCodexLogin(host);
      return;
    }
    if (lower === 'xai') {
      await handleXaiLogin(host);
      return;
    }
    if (lower === 'xai-api-key') {
      await handleXaiApiKeyLogin(host);
      return;
    }
    if (lower === 'kimi' || lower === 'kimi-code' || lower === 'andrewcode' || lower === 'managed') {
      await handleKimiCodeOAuthLogin(host);
      return;
    }
    const platform = getOpenPlatformById(lower);
    if (platform !== undefined) {
      await handleOpenPlatformLogin(host, platform);
      return;
    }
    host.showError(
      `Unknown login target "${trimmed}". Use: andrewcode, kimi-code, kimi-platform, xai, xai-api-key, claude, codex, or perplexity.`,
    );
    return;
  }

  const platformId = await promptPlatformSelection(host);
  if (platformId === undefined) return;

  if (platformId === 'claude') {
    await handleExternalCliLogin(host, 'claude');
    return;
  }
  if (platformId === 'perplexity') {
    await handleExternalCliLogin(host, 'perplexity');
    return;
  }
  if (platformId === 'codex') {
    await handleNativeCodexLogin(host);
    return;
  }
  if (platformId === 'xai') {
    await handleXaiLogin(host);
    return;
  }
  if (platformId === 'xai-api-key') {
    await handleXaiApiKeyLogin(host);
    return;
  }

  if (platformId === 'kimi-code') {
    await handleKimiCodeOAuthLogin(host);
    return;
  }

  const platform = getOpenPlatformById(platformId);
  if (platform === undefined) return;
  await handleOpenPlatformLogin(host, platform);
}

async function handleKimiCodeOAuthLogin(host: SlashCommandHost): Promise<void> {
  const status = await host.harness.auth.status(DEFAULT_OAUTH_PROVIDER_NAME);
  const alreadyLoggedIn = status.providers.some(
    (provider) => provider.providerName === DEFAULT_OAUTH_PROVIDER_NAME && provider.hasToken,
  );

  let spinner: LoginProgressSpinnerHandle | undefined;
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;
  try {
    await host.harness.auth.login(DEFAULT_OAUTH_PROVIDER_NAME, {
      signal: controller.signal,
      onDeviceCode: (data) => {
        spinner = host.showLoginAuthorizationPrompt(data);
      },
    });
    spinner?.stop({ ok: true, label: 'Logged in.' });
    spinner = undefined;
    try {
      await host.authFlow.refreshConfigAfterLogin();
    } catch (refreshError) {
      const message = formatErrorMessage(refreshError);
      host.showError(`Authentication successful, but failed to refresh config: ${message}`);
      return;
    }
    host.track('login', {
      provider: DEFAULT_OAUTH_PROVIDER_NAME,
      method: 'oauth',
      already_logged_in: alreadyLoggedIn,
    });
    if (alreadyLoggedIn) {
      host.showStatus('Already logged in. Model configuration refreshed.', 'success');
    }
  } catch (error) {
    const cancelled = controller.signal.aborted;
    spinner?.stop({
      ok: false,
      label: cancelled ? 'Login cancelled.' : 'Login failed.',
    });
    spinner = undefined;
    if (cancelled) return;
    log.warn('login failed', {
      providerName: DEFAULT_OAUTH_PROVIDER_NAME,
      alreadyLoggedIn,
      sessionId: host.session?.id,
      error,
    });
    const message = formatErrorMessage(error);
    host.showError(`Login failed: ${message}`);
  } finally {
    if (host.cancelInFlight === cancelLogin) {
      host.cancelInFlight = undefined;
    }
  }
}

async function handleOpenPlatformLogin(
  host: SlashCommandHost,
  platform: OpenPlatformDefinition,
): Promise<void> {
  const consoleHost = platform.consoleUrl?.replace(/^https?:\/\//, '') ?? '';
  const platformName = consoleHost.length > 0 ? `Kimi Platform (${consoleHost})` : 'Kimi Platform';
  const subtitleLines = [
    `${'base_url'.padEnd(12)}${platform.baseUrl}`,
    `${'saved to'.padEnd(12)}~/.andrewcode/config.toml`,
  ];
  const apiKey = await promptApiKey(host, platformName, subtitleLines);
  if (apiKey === undefined) return;

  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;

  let models: ManagedKimiCodeModelInfo[];
  try {
    models = await fetchOpenPlatformModels(platform, apiKey, fetch, controller.signal);
    models = filterModelsByPrefix(models, platform);
  } catch (error) {
    if (controller.signal.aborted) return;
    const msg = formatErrorMessage(error);
    host.showError(`Failed to verify API key: ${msg}`);
    if (
      error instanceof OpenPlatformApiError &&
      error.status === 401
    ) {
      host.showStatus(
        'Hint: If your API key was obtained from Kimi/AndrewCode, please select "AndrewCode / Kimi Code (OAuth)" instead.',
      );
    }
    return;
  } finally {
    if (host.cancelInFlight === cancelLogin) {
      host.cancelInFlight = undefined;
    }
  }

  if (models.length === 0) {
    host.showError('No models available for this platform.');
    return;
  }

  const selection = await promptModelSelectionForOpenPlatform(host, models, platform);
  if (selection === undefined) return;

  const existingConfig = await host.harness.getConfig();
  if (existingConfig.providers[platform.id] !== undefined) {
    await host.harness.removeProvider(platform.id);
  }

  const config = await host.harness.getConfig();
  applyOpenPlatformConfig(config as ManagedKimiConfigShape, {
    platform,
    models,
    selectedModel: selection.model,
    thinking: selection.thinking !== 'off',
    effort:
      selection.thinking !== 'off' && selection.thinking !== 'on'
        ? selection.thinking
        : undefined,
    apiKey,
  });

  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
    thinking: config.thinking,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('login', { provider: platform.id, method: 'api_key' });
  host.showStatus(`Setup complete: ${platform.name} · ${selection.model.id}`);
}

async function handleNativeCodexLogin(host: SlashCommandHost): Promise<void> {
  host.showStatus('Starting ChatGPT Codex OAuth in the browser…');
  try {
    const credentials = await loginCodex({
      openUrl,
      onProgress: (progress) => {
        host.showStatus(`Codex login opened in your browser. If it did not open, use: ${progress.authorizationUrl}`);
      },
    });
    const catalog = await fetchCodexCatalog({ credentials, forceRefresh: true });
    const models = catalog.models.length > 0 ? catalog.models : embedCodexModels();
    const config = await host.harness.getConfig();
    applyCodexConfig(config as ManagedKimiConfigShape, models);
    applyCodexAuthHeaders(config as ManagedKimiConfigShape, credentials);
    await host.harness.setConfig({
      providers: config.providers,
      models: config.models,
      defaultModel: config.defaultModel,
    });
    await host.authFlow.refreshConfigAfterLogin();
    host.track('login', { provider: 'codex', method: 'oauth' });
    host.showStatus(
      `Codex connected${credentials.email !== undefined ? ` as ${credentials.email}` : ''}. Catalog: ${catalog.source}.`,
      'success',
    );
  } catch (error) {
    host.showError(`Codex login failed: ${formatErrorMessage(error)}`);
  }
}

async function handleXaiLogin(host: SlashCommandHost): Promise<void> {
  host.showStatus('Starting xAI Grok OAuth…');
  const controller = new AbortController();
  const cancelLogin = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancelLogin;
  try {
    const credentials = await loginXai({
      homeDir: host.harness.homeDir,
      openUrl,
      signal: controller.signal,
      surface: 'ui',
      onProgress: (progress) => {
        host.showStatus(
          `Open ${progress.authorizationUrl} and confirm code ${progress.userCode}.`,
        );
      },
    });
    const config = await host.harness.getConfig();
    applyXaiOAuthConfig(config as ManagedKimiConfigShape);
    await host.harness.setConfig({
      providers: config.providers,
      models: config.models,
      defaultModel: config.defaultModel,
    });
    await host.authFlow.refreshConfigAfterLogin();
    host.track('login', { provider: 'xai', method: 'oauth' });
    host.showStatus(
      `xAI Grok connected${credentials.refreshToken !== undefined ? ' with renewable OAuth credentials' : ''}. Use /model to switch models.`,
      'success',
    );
  } catch (error) {
    if (controller.signal.aborted) return;
    host.showError(`xAI Grok login failed: ${formatErrorMessage(error)}`);
  } finally {
    if (host.cancelInFlight === cancelLogin) host.cancelInFlight = undefined;
  }
}

async function handleXaiApiKeyLogin(host: SlashCommandHost): Promise<void> {
  const apiKey = await promptApiKey(host, 'xAI Grok', [
    `${'base_url'.padEnd(12)}https://api.x.ai/v1`,
    `${'saved to'.padEnd(12)}~/.andrewcode/auth.json`,
  ]);
  if (apiKey === undefined) return;
  saveXaiApiKey(apiKey);
  const config = await host.harness.getConfig();
  applyXaiConfig(config as ManagedKimiConfigShape, apiKey);
  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
    defaultModel: config.defaultModel,
  });
  await host.authFlow.refreshConfigAfterLogin();
  host.track('login', { provider: 'xai', method: 'api_key' });
  host.showStatus('xAI setup complete. Use /model to switch to a Grok model.', 'success');
}

async function handleExternalCliLogin(
  host: SlashCommandHost,
  target: 'claude' | 'codex' | 'perplexity',
): Promise<void> {
  const { spawnSync } = await import('node:child_process');
  const probeBinary = target === 'perplexity' ? 'pwm' : target;
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const probe = spawnSync(whichCmd, [probeBinary], { encoding: 'utf8', windowsHide: true, timeout: 5_000 });
  const found = probe.status === 0 && (probe.stdout ?? '').trim().length > 0;
  const binPath = found ? (probe.stdout ?? '').split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) : undefined;

  if (!found) {
    const hint =
      target === 'claude'
        ? 'Install Claude Code from https://code.claude.com/docs/en/setup'
        : target === 'perplexity'
          ? 'Install the Perplexity sidecar (`pwm`), then re-run'
          : 'Install Codex CLI via `npm i -g @openai/codex`';
    host.showError(`${probeBinary} CLI not found on PATH. ${hint}`);
    host.showStatus(`After installing, run \`andrewcode login ${target}\` in a terminal where a browser can open.`);
    return;
  }

  const loginHint =
    target === 'perplexity'
      ? `pwm found at ${binPath ?? 'pwm'}. Run \`andrewcode login perplexity\` in a separate terminal to complete the Perplexity session login, then start the sidecar with \`pwm api\` before chatting. ` +
        `The TUI cannot spawn the interactive login while in raw mode. After login, run \`/login --status\` or \`andrewcode login --status\` to verify.`
      : `${target} found at ${binPath ?? target}. Run \`andrewcode login ${target}\` in a separate terminal to complete OAuth (browser required). ` +
        `The TUI cannot spawn the interactive login while in raw mode. After login, run \`/login --status\` or \`andrewcode login --status\` to verify.`;
  host.showStatus(loginHint);

  // Also show the Fusion status probe so the user sees all panelists.
  try {
    const { formatExternalAuthStatus } = await import('#/cli/external-cli-auth');
    host.showStatus(formatExternalAuthStatus());
  } catch {
    // non-critical
  }
}

export async function handleLogoutCommand(host: SlashCommandHost): Promise<void> {
  const oauthStatus = await host.harness.auth.status(DEFAULT_OAUTH_PROVIDER_NAME);
  const hasOAuthToken = oauthStatus.providers.some(
    (p) => p.providerName === DEFAULT_OAUTH_PROVIDER_NAME && p.hasToken,
  );
  const config = await host.harness.getConfig();
  const hasManagedRemnant =
    hasOAuthToken || config.providers[DEFAULT_OAUTH_PROVIDER_NAME] !== undefined;
  const apiKeyProviderIds = Object.keys(config.providers ?? {})
    .filter((id) => id !== DEFAULT_OAUTH_PROVIDER_NAME)
    .toSorted();

  const options: ChoiceOption[] = [];
  if (hasManagedRemnant) {
    options.push({
      value: DEFAULT_OAUTH_PROVIDER_NAME,
      label: PRODUCT_NAME,
      description: 'OAuth login',
    });
  }
  for (const id of apiKeyProviderIds) {
    const baseUrl = config.providers[id]?.baseUrl;
    options.push({
      value: id,
      label: id,
      description: typeof baseUrl === 'string' && baseUrl.length > 0 ? baseUrl : undefined,
    });
  }

  if (options.length === 0) {
    host.showStatus('Nothing to logout.');
    return;
  }

  const currentModel = host.state.appState.model.trim();
  const currentProvider = host.state.appState.availableModels[currentModel]?.provider;

  const target = await promptLogoutProviderSelection(host, options, currentProvider);
  if (target === undefined) return;

  if (target === DEFAULT_OAUTH_PROVIDER_NAME) {
    await host.harness.auth.logout(DEFAULT_OAUTH_PROVIDER_NAME);
  } else {
    await host.harness.removeProvider(target);
  }

  if (target === currentProvider) {
    await host.authFlow.refreshConfigAfterLogout();
    await host.authFlow.clearActiveSessionAfterLogout();
  } else {
    const updated = await host.harness.getConfig({ reload: true });
    host.setAppState({
      availableModels: updated.models ?? {},
      availableProviders: updated.providers ?? {},
    });
  }

  host.track('logout', { provider: target });
  const label = target === DEFAULT_OAUTH_PROVIDER_NAME ? PRODUCT_NAME : target;
  host.showStatus(`Logged out from ${label}.`);
}
