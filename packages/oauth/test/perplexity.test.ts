import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyPerplexityConfig,
  EMBEDDED_PERPLEXITY_MODELS,
  findPwmBinary,
  hasPwmSession,
  PERPLEXITY_PROVIDER_NAME,
  profileForProviderName,
  pwmAskOutputToHits,
  PWM_SESSION_TOKEN_ENV,
  removePerplexityConfig,
  type ManagedKimiConfigShape,
} from '../src/index';

const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
  delete process.env[PWM_SESSION_TOKEN_ENV];
  vi.unstubAllGlobals();
});

describe('perplexity provider config', () => {
  it('registers the provider with type anthropic and a /v1-free base URL', () => {
    const config: ManagedKimiConfigShape = { providers: {}, models: {} };
    applyPerplexityConfig(config, 'http://127.0.0.1:8080/v1');
    expect(config.providers[PERPLEXITY_PROVIDER_NAME]).toMatchObject({
      type: 'anthropic',
      baseUrl: 'http://127.0.0.1:8080',
      apiKey: 'perplexity',
    });
  });

  it('registers one code_mode_only alias per catalog model', () => {
    const config: ManagedKimiConfigShape = { providers: {}, models: {} };
    applyPerplexityConfig(config, 'http://127.0.0.1:8080');
    expect(EMBEDDED_PERPLEXITY_MODELS).toHaveLength(12);
    for (const model of EMBEDDED_PERPLEXITY_MODELS) {
      expect(config.models?.[`perplexity/${model.id}`]).toMatchObject({
        provider: PERPLEXITY_PROVIDER_NAME,
        model: model.id,
        maxContextSize: model.maxContextSize,
        capabilities: ['thinking', 'tool_use'],
        toolMode: 'code_mode_only',
      });
    }
  });

  it('selects the requested default model and removes every alias on logout', () => {
    const config: ManagedKimiConfigShape = { providers: {}, models: {} };
    applyPerplexityConfig(config, 'http://127.0.0.1:8080', 'perplexity-research');
    expect(config.defaultModel).toBe('perplexity/perplexity-research');

    removePerplexityConfig(config);
    expect(config.providers[PERPLEXITY_PROVIDER_NAME]).toBeUndefined();
    expect(
      Object.values(config.models ?? {}).filter(
        (alias) => (alias as { provider?: string }).provider === PERPLEXITY_PROVIDER_NAME,
      ),
    ).toHaveLength(0);
  });

  it('preserves other providers and the default when removing', () => {
    const config: ManagedKimiConfigShape = {
      providers: { other: { type: 'openai' } },
      models: { other: { provider: 'other', model: 'other', maxContextSize: 1 } },
      defaultModel: 'other',
    };
    applyPerplexityConfig(config, 'http://127.0.0.1:8080');
    removePerplexityConfig(config);
    expect(config.providers['other']).toBeDefined();
    expect(config.models?.['other']).toBeDefined();
    expect(config.defaultModel).toBe('other');
  });

  it('maps perplexity provider names to the perplexity profile', () => {
    expect(profileForProviderName('perplexity').id).toBe('perplexity');
    expect(profileForProviderName('perplexity:default').id).toBe('perplexity');
    const profile = profileForProviderName('perplexity');
    expect(profile.backends).toEqual(['messages']);
    expect(profile.hostedSearch).toBe('none');
    expect(profile.nativeWebSearch).toBe(true);
    expect(profile.allowsPerplexityFallback).toBe(false);
    expect(profile.allowsXaiExports).toBe(false);
    expect(profile.sessionCredential).toBe('none');
    expect(profile.displayName).toBe('Perplexity');
  });
});

describe('pwm session detection', () => {
  it('finds a session from the env fallback', () => {
    process.env[PWM_SESSION_TOKEN_ENV] = 'session-token';
    expect(hasPwmSession()).toBe(true);
  });

  it('finds a session from the token file', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-pwm-home-'));
    tempDirs.push(homeDir);
    const tokenDir = join(homeDir, '.config', 'perplexity-web-mcp');
    mkdirSync(tokenDir, { recursive: true });
    writeFileSync(join(tokenDir, 'token'), 'token-value');
    expect(hasPwmSession(homeDir)).toBe(true);
  });

  it('reports no session when neither source exists', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-pwm-empty-'));
    tempDirs.push(homeDir);
    expect(hasPwmSession(homeDir)).toBe(false);
  });

  it('returns undefined when pwm is not on PATH', () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-pwm-empty-path-'));
    tempDirs.push(homeDir);
    const previousPath = process.env['PATH'];
    process.env['PATH'] = homeDir;
    try {
      expect(findPwmBinary()).toBeUndefined();
    } finally {
      if (previousPath === undefined) delete process.env['PATH'];
      else process.env['PATH'] = previousPath;
    }
  });
});

describe('pwm ask output parsing', () => {
  it('parses the explicit-model JSON shape into hits', () => {
    const hits = pwmAskOutputToHits(
      JSON.stringify({
        answer: 'The sky is blue.',
        citations: ['https://example.com/sky', 'https://example.com/blue'],
        model: 'sonar',
        source: 'web',
      }),
    );
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ url: 'https://example.com/sky', snippet: 'The sky is blue.' });
  });

  it('parses the smart-routing JSON shape into hits', () => {
    const hits = pwmAskOutputToHits(
      JSON.stringify({
        answer: 'Routed answer.',
        citations: ['https://example.com/routed'],
        routing: { model: 'perplexity-sonar', intent: 'standard' },
      }),
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ url: 'https://example.com/routed' });
  });

  it('parses the plain-text citations footer', () => {
    const hits = pwmAskOutputToHits(
      'Answer text here.\n\nCitations:\n[1]: https://example.com/a\n[2]: https://example.com/b\n',
    );
    expect(hits.map((hit) => hit.url)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(hits[0]?.snippet).toBe('Answer text here.');
  });

  it('returns an empty list for empty output', () => {
    expect(pwmAskOutputToHits('   \n')).toEqual([]);
  });
});
