import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchCodexCatalog,
  refreshProviderModels,
  type ManagedKimiConfigShape,
  type RefreshProviderHost,
} from '../src/index';

const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

function makeHost(initial: ManagedKimiConfigShape, homeDir: string): {
  host: RefreshProviderHost;
  current: () => ManagedKimiConfigShape;
} {
  let persisted = structuredClone(initial);
  return {
    current: () => structuredClone(persisted),
    host: {
      homeDir,
      getConfig: async () => structuredClone(persisted),
      removeProvider: async (providerId: string) => {
        const providers = { ...persisted.providers };
        delete providers[providerId];
        const models = { ...persisted.models };
        for (const [alias, model] of Object.entries(models)) {
          if (model.provider === providerId) delete models[alias];
        }
        persisted = { ...persisted, providers, models };
        return structuredClone(persisted);
      },
      setConfig: async (patch: ManagedKimiConfigShape) => {
        persisted = { ...persisted, ...patch };
        return structuredClone(persisted);
      },
      resolveOAuthToken: async () => {
        throw new Error('should not need OAuth token for codex branch');
      },
    },
  };
}

function codexModelsPayload(): unknown {
  return {
    models: [
      {
        slug: 'gpt-6-sol',
        display_name: 'GPT-6 Sol',
        context_window: 272000,
        tool_mode: 'code_mode_only',
        multi_agent_version: 'v2',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [
          { effort: 'low' },
          { effort: 'medium' },
          { effort: 'high' },
        ],
        visibility: 'list',
      },
      {
        slug: 'gpt-6-astra',
        display_name: 'GPT-6 Astra',
        context_window: 272000,
        tool_mode: 'code_mode_only',
        multi_agent_version: 'v2',
        default_reasoning_level: 'medium',
        supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }],
        visibility: 'list',
      },
    ],
  };
}

describe('codex catalog refresh', () => {
  it('forceRefresh bypasses a fresh cache so re-login re-pings the endpoint', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-codex-forcerefresh-'));
    tempDirs.push(homeDir);
    const credentials = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      isWorkspaceAccount: false,
      accountIsFedramp: false,
    };
    const livePayload = {
      models: [
        {
          slug: 'gpt-6-sol',
          display_name: 'GPT-6 Sol',
          context_window: 272000,
          supported_reasoning_levels: [{ effort: 'low' }],
          visibility: 'list',
        },
      ],
    };
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(livePayload), { status: 200 }));

    const first = await fetchCodexCatalog({ credentials, homeDir, fetchImpl });
    expect(first.source).toBe('live');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // A second call within the TTL serves the cache…
    const second = await fetchCodexCatalog({ credentials, homeDir, fetchImpl });
    expect(second.source).toBe('cache');
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // …unless the caller forces a live re-ping (login / refresh path).
    const third = await fetchCodexCatalog({
      credentials,
      homeDir,
      fetchImpl,
      forceRefresh: true,
    });
    expect(third.source).toBe('live');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('refreshProviderModels pulls new codex models without touching other providers', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-codex-refresh-'));
    tempDirs.push(homeDir);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(homeDir, 'codex-auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          account_id: 'account-1',
        },
        last_refresh: new Date().toISOString(),
      }),
    );
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(codexModelsPayload()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { host, current } = makeHost(
      {
        providers: {
          codex: {
            type: 'openai_responses',
            baseUrl: 'https://chatgpt.com/backend-api/codex',
            oauth: { storage: 'file', key: 'codex' },
          },
          other: {
            type: 'openai',
            baseUrl: 'https://other.example.test/v1',
            apiKey: 'sk-other',
          },
        },
        models: {
          'gpt-5.6-sol': {
            provider: 'codex',
            model: 'gpt-5.6-sol',
            maxContextSize: 272000,
          },
          'other/m1': {
            provider: 'other',
            model: 'm1',
            maxContextSize: 131072,
          },
        },
      },
      homeDir,
    );

    const result = await refreshProviderModels(host, { providerId: 'codex' });

    expect(result.failed).toEqual([]);
    expect(result.changed).toEqual([
      { providerId: 'codex', providerName: 'Codex', added: 2, removed: 1 },
    ]);
    expect(current().models?.['gpt-6-sol']).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-sol',
    });
    expect(current().models?.['gpt-6-astra']).toMatchObject({
      provider: 'codex',
      model: 'gpt-6-astra',
    });
    expect(current().models?.['gpt-5.6-sol']).toBeUndefined();
    expect(current().models?.['other/m1']).toBeDefined();
    // Custom headers from the stored credentials must be stamped on refresh.
    expect(current().providers['codex']).toMatchObject({
      customHeaders: expect.objectContaining({ originator: 'codex_cli_rs' }),
    });
  });

  it('a scoped codex refresh preserves the user default model', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-codex-default-'));
    tempDirs.push(homeDir);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(homeDir, 'codex-auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          account_id: 'account-1',
        },
        last_refresh: new Date().toISOString(),
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify(codexModelsPayload()), { status: 200 }),
      ),
    );

    const { host, current } = makeHost(
      {
        providers: {
          codex: {
            type: 'openai_responses',
            baseUrl: 'https://chatgpt.com/backend-api/codex',
            oauth: { storage: 'file', key: 'codex' },
          },
          other: {
            type: 'openai',
            baseUrl: 'https://other.example.test/v1',
            apiKey: 'sk-other',
          },
        },
        models: {
          'other/m1': {
            provider: 'other',
            model: 'm1',
            maxContextSize: 131072,
          },
        },
        defaultModel: 'other/m1',
      },
      homeDir,
    );

    const result = await refreshProviderModels(host, { providerId: 'codex' });
    expect(result.failed).toEqual([]);
    expect(current().defaultModel).toBe('other/m1');
  });

  it('reports a helpful failure when codex credentials are missing', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-codex-nocreds-'));
    tempDirs.push(homeDir);
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('{}', { status: 200 })),
    );
    const { host } = makeHost(
      {
        providers: {
          codex: {
            type: 'openai_responses',
            baseUrl: 'https://chatgpt.com/backend-api/codex',
            oauth: { storage: 'file', key: 'codex' },
          },
        },
        models: {},
      },
      homeDir,
    );

    const result = await refreshProviderModels(host, { providerId: 'codex' });
    expect(result.changed).toEqual([]);
    expect(result.failed).toEqual([
      { provider: 'codex', reason: expect.stringContaining('login --codex') },
    ]);
  });

  it('scope oauth includes the codex provider', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-codex-oauthscope-'));
    tempDirs.push(homeDir);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(
      join(homeDir, 'codex-auth.json'),
      JSON.stringify({
        auth_mode: 'chatgpt',
        tokens: {
          id_token: 'id-token',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          account_id: 'account-1',
        },
        last_refresh: new Date().toISOString(),
      }),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify(codexModelsPayload()), { status: 200 }),
      ),
    );
    const { host } = makeHost(
      {
        providers: {
          codex: {
            type: 'openai_responses',
            baseUrl: 'https://chatgpt.com/backend-api/codex',
            oauth: { storage: 'file', key: 'codex' },
          },
        },
        models: {},
      },
      homeDir,
    );

    const result = await refreshProviderModels(host, { scope: 'oauth' });
    expect(result.failed).toEqual([]);
    expect(result.changed.map((c) => c.providerId)).toContain('codex');
  });
});
