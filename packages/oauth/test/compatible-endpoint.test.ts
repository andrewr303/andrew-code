import { describe, expect, it, vi } from 'vitest';

import {
  applyCompatibleEndpointConfig,
  assertUsableProviderId,
  fetchCompatibleEndpointModels,
  slugifyProviderId,
  type ManagedKimiConfigShape,
} from '../src/index';

describe('slugifyProviderId', () => {
  it('turns a display name into a config.toml provider id', () => {
    expect(slugifyProviderId('My Local LLM')).toBe('my-local-llm');
  });

  it('rejects reserved ids', () => {
    expect(() => assertUsableProviderId('qwen-token-plan')).toThrow(/reserved/);
    expect(() => assertUsableProviderId('')).toThrow(/letter or digit/);
  });
});

describe('fetchCompatibleEndpointModels', () => {
  it('lists OpenAI-compatible models and skips embeddings', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: 'gpt-test', context_length: 128000, display_name: 'GPT Test' },
            { id: 'text-embedding-3-small' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const models = await fetchCompatibleEndpointModels({
      baseUrl: 'https://gateway.example.test/v1',
      apiKey: 'sk-test',
      protocol: 'openai',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://gateway.example.test/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      }),
    );
    expect(models).toEqual([
      {
        id: 'gpt-test',
        displayName: 'GPT Test',
        contextLength: 128000,
        capabilities: ['tool_use'],
      },
    ]);
  });

  it('lists Anthropic-compatible models from /v1/models', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'claude-test', display_name: 'Claude Test' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const models = await fetchCompatibleEndpointModels({
      baseUrl: 'https://anthropic.example.test',
      apiKey: 'sk-ant-test',
      protocol: 'anthropic',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://anthropic.example.test/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-test',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
    expect(models.map((model) => model.id)).toEqual(['claude-test']);
  });
});

describe('applyCompatibleEndpointConfig', () => {
  it('writes the provider, models, and compatibleEndpoint source', () => {
    const config: ManagedKimiConfigShape = { providers: {}, models: {} };
    applyCompatibleEndpointConfig(config, {
      providerId: 'local-llm',
      displayName: 'Local LLM',
      protocol: 'openai',
      baseUrl: 'https://localhost:11434/v1',
      apiKey: 'sk-local',
      models: [{ id: 'llama', contextLength: 32000, capabilities: ['tool_use'] }],
    });

    expect(config.providers['local-llm']).toMatchObject({
      type: 'openai',
      baseUrl: 'https://localhost:11434/v1',
      apiKey: 'sk-local',
      source: { kind: 'compatibleEndpoint', protocol: 'openai', displayName: 'Local LLM' },
    });
    expect(config.models?.['local-llm/llama']).toMatchObject({
      provider: 'local-llm',
      model: 'llama',
      maxContextSize: 32000,
    });
    expect(config.defaultModel).toBe('local-llm/llama');
  });
});
