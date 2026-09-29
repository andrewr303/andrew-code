import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyCodexConfig,
  canUsePerplexityFallback,
  fetchCodexCatalog,
  mapCodexWireEffort,
  profileForProviderName,
  requestAuthHeaders,
  type ManagedKimiConfigShape,
  ultraEnablesProactive,
} from '../src/index';
import { EMBEDDED_CODEX_MODELS } from '../src/codex/catalog';

const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('provider profiles', () => {
  it('isolates Codex from xAI exports and Perplexity fallback', () => {
    const profile = profileForProviderName('codex');
    expect(profile.id).toBe('codex');
    expect(profile.allowsXaiExports).toBe(false);
    expect(canUsePerplexityFallback(profile)).toBe(false);
    expect(profile.hostedSearch).toBe('openai');
  });

  it('allows Perplexity only for Kimi Platform and Kimi Code', () => {
    expect(canUsePerplexityFallback(profileForProviderName('managed:kimi-code'))).toBe(true);
    expect(canUsePerplexityFallback(profileForProviderName('moonshot-cn'))).toBe(true);
    expect(canUsePerplexityFallback(profileForProviderName('xai'))).toBe(false);
  });

  it('maps QwenCloud Token Plan ids to the qwen-token-plan profile', () => {
    expect(profileForProviderName('qwen-token-plan').id).toBe('qwen-token-plan');
    expect(profileForProviderName('qwen-token-plan-anthropic').id).toBe('qwen-token-plan');
    expect(profileForProviderName('qwen-token-plan').backends).toEqual(['responses', 'messages']);
  });
});

describe('Codex effort mapping', () => {
  it('maps Max and Ultra to the max wire effort and enables Ultra proactive only on multi-agent v2', () => {
    expect(mapCodexWireEffort('max')).toBe('max');
    expect(mapCodexWireEffort('ultra')).toBe('max');
    const sol = EMBEDDED_CODEX_MODELS.find((model) => model.id === 'gpt-5.6-sol');
    const luna = EMBEDDED_CODEX_MODELS.find((model) => model.id === 'gpt-5.6-luna');
    expect(sol).toBeDefined();
    expect(luna).toBeDefined();
    expect(ultraEnablesProactive(sol!, 'ultra')).toBe(true);
    expect(ultraEnablesProactive(luna!, 'ultra')).toBe(false);
    expect(ultraEnablesProactive(sol!, 'max')).toBe(false);
  });

  it('parses the Codex catalog reasoning-level fields and applies every declared tier', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-codex-catalog-'));
    tempDirs.push(homeDir);
    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          models: [
            {
              id: 'gpt-5.6-sol',
              display_name: 'GPT-5.6 Sol',
              context_window: 353000,
              default_reasoning_level: 'low',
              supported_reasoning_levels: [
                { effort: 'low', description: 'Low' },
                { effort: 'medium', description: 'Medium' },
                { effort: 'high', description: 'High' },
                { effort: 'xhigh', description: 'Extra high' },
                { effort: 'max', description: 'Maximum' },
                { effort: 'ultra', description: 'Ultra' },
              ],
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    const credentials = {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      isWorkspaceAccount: false,
      accountIsFedramp: false,
    };

    const catalog = await fetchCodexCatalog({ credentials, homeDir, fetchImpl });
    expect(catalog.models[0]?.reasoningEfforts.map((effort) => effort.value)).toEqual([
      'low',
      'medium',
      'high',
      'xhigh',
      'max',
      'ultra',
    ]);
    expect(catalog.models[0]?.defaultEffort).toBe('low');

    const config: ManagedKimiConfigShape = { providers: {}, models: {} };
    applyCodexConfig(config, catalog.models);
    expect(config.models?.['gpt-5.6-sol']).toMatchObject({
      capabilities: ['thinking', 'always_thinking', 'tool_use'],
      supportEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      defaultEffort: 'low',
    });
  });
});

describe('Codex request identity', () => {
  it('sends the client identity and version required by the Codex backend', () => {
    const headers = requestAuthHeaders({
      accessToken: 'access-token',
      accountId: 'account-id',
      isWorkspaceAccount: false,
      accountIsFedramp: false,
      idToken: 'id-token',
      refreshToken: 'refresh-token',
    });

    expect(headers).toMatchObject({
      Authorization: 'Bearer access-token',
      originator: 'codex_cli_rs',
      'chatgpt-account-id': 'account-id',
    });
    expect(headers['version']).toMatch(/^\d+\.\d+\.\d+$/);
    expect(headers['user-agent']).toBe(`codex_cli_rs/${headers['version']}`);
  });
});
