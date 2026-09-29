import { describe, expect, it, vi } from 'vitest';

import {
  applyQwenTokenPlanConfig,
  fetchQwenTokenPlanModels,
  isQwenTokenPlanResponsesBaseUrl,
  qwenHostedBuiltinToolsForModel,
  QWEN_TOKEN_PLAN_OPENAI_BASE_URL,
  type ManagedKimiConfigShape,
} from '../src/index';

describe('qwen hosted tools', () => {
  it('detects the Token Plan Responses base URL', () => {
    expect(isQwenTokenPlanResponsesBaseUrl(QWEN_TOKEN_PLAN_OPENAI_BASE_URL)).toBe(true);
    expect(isQwenTokenPlanResponsesBaseUrl('https://api.x.ai/v1')).toBe(false);
  });

  it('maps Harness tools per Qwen model family', () => {
    expect(qwenHostedBuiltinToolsForModel('qwen3.8-max')).toEqual([
      'web_search',
      'code_interpreter',
      'web_extractor',
      'web_search_image',
      'image_search',
    ]);
    expect(qwenHostedBuiltinToolsForModel('qwen3.7-max')).toEqual([
      'web_search',
      'code_interpreter',
      'web_extractor',
    ]);
    expect(qwenHostedBuiltinToolsForModel('glm-5.3')).toEqual([]);
  });
});

describe('fetchQwenTokenPlanModels', () => {
  it('overlays live /models ids with catalog metadata', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'qwen3.8-flash' }, { id: 'custom-chat' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const models = await fetchQwenTokenPlanModels({
      protocol: 'openai',
      apiKey: 'sk-sp-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(models.find((model) => model.id === 'qwen3.8-flash')).toMatchObject({
      contextLength: 983616,
      defaultEffort: 'xhigh',
      capabilities: expect.arrayContaining(['thinking', 'tool_use', 'image_in']),
    });
    expect(models.find((model) => model.id === 'custom-chat')?.id).toBe('custom-chat');
  });

  it('falls back to the documented catalog when /models fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    const models = await fetchQwenTokenPlanModels({
      protocol: 'anthropic',
      apiKey: 'sk-sp-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(models.some((model) => model.id === 'qwen3.8-max')).toBe(true);
  });
});

describe('applyQwenTokenPlanConfig', () => {
  it('stores the OpenAI Responses provider and qwenTokenPlan source', () => {
    const config: ManagedKimiConfigShape = { providers: {}, models: {} };
    applyQwenTokenPlanConfig(config, {
      protocol: 'openai',
      apiKey: 'sk-sp-test',
      models: [{ id: 'qwen3.8-max' }],
    });
    expect(config.providers['qwen-token-plan']).toMatchObject({
      type: 'openai_responses',
      baseUrl: QWEN_TOKEN_PLAN_OPENAI_BASE_URL,
      source: { kind: 'qwenTokenPlan', protocol: 'openai' },
    });
    expect(config.models?.['qwen-token-plan/qwen3.8-max']).toMatchObject({
      maxContextSize: 983616,
      defaultEffort: 'xhigh',
    });
  });
});
