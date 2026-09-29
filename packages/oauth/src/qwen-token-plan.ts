import {
  applyCompatibleEndpointConfig,
  fetchCompatibleEndpointModels,
  type CompatibleEndpointProtocol,
  type CompatibleListedModel,
} from './compatible-endpoint';
import type { ManagedKimiConfigShape } from './managed-kimi-code';

export const QWEN_TOKEN_PLAN_OPENAI_PROVIDER_ID = 'qwen-token-plan';
export const QWEN_TOKEN_PLAN_ANTHROPIC_PROVIDER_ID = 'qwen-token-plan-anthropic';

export const QWEN_TOKEN_PLAN_OPENAI_BASE_URL =
  'https://token-plan.maas.qwencloudapi.com/compatible-mode/v1';
export const QWEN_TOKEN_PLAN_ANTHROPIC_BASE_URL =
  'https://token-plan.maas.qwencloudapi.com/apps/anthropic';

export type QwenTokenPlanProtocol = 'openai' | 'anthropic';

export interface QwenTokenPlanDefinition {
  readonly providerId: string;
  readonly displayName: string;
  readonly protocol: CompatibleEndpointProtocol;
  readonly baseUrl: string;
  readonly wireProtocol: QwenTokenPlanProtocol;
}

export const QWEN_TOKEN_PLAN_OPENAI: QwenTokenPlanDefinition = {
  providerId: QWEN_TOKEN_PLAN_OPENAI_PROVIDER_ID,
  displayName: 'QwenCloud Token Plan (OpenAI Responses)',
  protocol: 'openai_responses',
  baseUrl: QWEN_TOKEN_PLAN_OPENAI_BASE_URL,
  wireProtocol: 'openai',
};

export const QWEN_TOKEN_PLAN_ANTHROPIC: QwenTokenPlanDefinition = {
  providerId: QWEN_TOKEN_PLAN_ANTHROPIC_PROVIDER_ID,
  displayName: 'QwenCloud Token Plan (Anthropic)',
  protocol: 'anthropic',
  baseUrl: QWEN_TOKEN_PLAN_ANTHROPIC_BASE_URL,
  wireProtocol: 'anthropic',
};

interface QwenCatalogModel {
  readonly id: string;
  readonly displayName: string;
  readonly contextLength: number;
  readonly imageIn: boolean;
  readonly supportEfforts: readonly string[];
  readonly defaultEffort: string;
}

const QWEN38_EFFORTS = ['low', 'medium', 'xhigh'] as const;
const QWEN_DEFAULT_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;

const QWEN_TOKEN_PLAN_CATALOG: readonly QwenCatalogModel[] = [
  {
    id: 'qwen3.8-max',
    displayName: 'qwen3.8-max',
    contextLength: 983_616,
    imageIn: true,
    supportEfforts: QWEN38_EFFORTS,
    defaultEffort: 'xhigh',
  },
  {
    id: 'qwen3.8-flash',
    displayName: 'qwen3.8-flash',
    contextLength: 983_616,
    imageIn: true,
    supportEfforts: QWEN38_EFFORTS,
    defaultEffort: 'xhigh',
  },
  {
    id: 'qwen3.7-max',
    displayName: 'qwen3.7-max',
    contextLength: 1_000_000,
    imageIn: false,
    supportEfforts: QWEN_DEFAULT_EFFORTS,
    defaultEffort: 'medium',
  },
  {
    id: 'qwen3.7-plus',
    displayName: 'qwen3.7-plus',
    contextLength: 1_000_000,
    imageIn: true,
    supportEfforts: QWEN_DEFAULT_EFFORTS,
    defaultEffort: 'medium',
  },
  {
    id: 'qwen3.6-flash',
    displayName: 'qwen3.6-flash',
    contextLength: 1_000_000,
    imageIn: true,
    supportEfforts: QWEN_DEFAULT_EFFORTS,
    defaultEffort: 'medium',
  },
  {
    id: 'glm-5.3',
    displayName: 'glm-5.3',
    contextLength: 1_000_000,
    imageIn: false,
    supportEfforts: QWEN_DEFAULT_EFFORTS,
    defaultEffort: 'medium',
  },
  {
    id: 'glm-5.2',
    displayName: 'glm-5.2',
    contextLength: 1_000_000,
    imageIn: false,
    supportEfforts: QWEN_DEFAULT_EFFORTS,
    defaultEffort: 'medium',
  },
  {
    id: 'deepseek-v4.1-flash',
    displayName: 'deepseek-v4.1-flash',
    contextLength: 1_000_000,
    imageIn: true,
    supportEfforts: QWEN_DEFAULT_EFFORTS,
    defaultEffort: 'medium',
  },
  {
    id: 'deepseek-v4-pro',
    displayName: 'deepseek-v4-pro',
    contextLength: 163_840,
    imageIn: false,
    supportEfforts: QWEN_DEFAULT_EFFORTS,
    defaultEffort: 'medium',
  },
  {
    id: 'deepseek-v4-pro-0813',
    displayName: 'deepseek-v4-pro-0813',
    contextLength: 163_840,
    imageIn: false,
    supportEfforts: QWEN_DEFAULT_EFFORTS,
    defaultEffort: 'medium',
  },
  {
    id: 'deepseek-v4-flash-0731',
    displayName: 'deepseek-v4-flash-0731',
    contextLength: 1_000_000,
    imageIn: false,
    supportEfforts: QWEN_DEFAULT_EFFORTS,
    defaultEffort: 'medium',
  },
];

const QWEN_CATALOG_BY_ID = new Map(QWEN_TOKEN_PLAN_CATALOG.map((model) => [model.id, model]));

export function isQwenTokenPlanProviderId(providerId: string): boolean {
  return (
    providerId === QWEN_TOKEN_PLAN_OPENAI_PROVIDER_ID ||
    providerId === QWEN_TOKEN_PLAN_ANTHROPIC_PROVIDER_ID
  );
}

export function getQwenTokenPlanDefinition(
  protocol: QwenTokenPlanProtocol,
): QwenTokenPlanDefinition {
  return protocol === 'anthropic' ? QWEN_TOKEN_PLAN_ANTHROPIC : QWEN_TOKEN_PLAN_OPENAI;
}

export function isQwenTokenPlanResponsesBaseUrl(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || baseUrl.length === 0) return false;
  return baseUrl.includes('token-plan.maas.qwencloudapi.com/compatible-mode');
}

export function qwenHostedBuiltinToolsForModel(modelId: string): readonly string[] {
  const id = modelId.toLowerCase();
  if (id.startsWith('qwen3.8-omni')) return ['web_search'];
  if (id.startsWith('qwen3.8-') || id.startsWith('qwen3.7-plus')) {
    return ['web_search', 'code_interpreter', 'web_extractor', 'web_search_image', 'image_search'];
  }
  if (id.startsWith('qwen3.7-max')) {
    return ['web_search', 'code_interpreter', 'web_extractor'];
  }
  return [];
}

function overlayCatalog(models: readonly CompatibleListedModel[]): CompatibleListedModel[] {
  return models.map((model) => {
    const known = QWEN_CATALOG_BY_ID.get(model.id);
    if (known === undefined) return model;
    const capabilities = new Set(model.capabilities ?? ['tool_use']);
    capabilities.add('thinking');
    capabilities.add('tool_use');
    if (known.imageIn) capabilities.add('image_in');
    return {
      id: model.id,
      displayName: known.displayName,
      contextLength: known.contextLength,
      capabilities: [...capabilities],
      supportEfforts: [...known.supportEfforts],
      defaultEffort: known.defaultEffort,
    };
  });
}

function catalogAsListedModels(): CompatibleListedModel[] {
  return QWEN_TOKEN_PLAN_CATALOG.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    contextLength: model.contextLength,
    capabilities: model.imageIn
      ? ['thinking', 'tool_use', 'image_in']
      : ['thinking', 'tool_use'],
    supportEfforts: [...model.supportEfforts],
    defaultEffort: model.defaultEffort,
  }));
}

export async function fetchQwenTokenPlanModels(
  options: {
    readonly protocol: QwenTokenPlanProtocol;
    readonly apiKey: string;
    readonly fetchImpl?: typeof fetch;
    readonly signal?: AbortSignal;
  },
): Promise<CompatibleListedModel[]> {
  const definition = getQwenTokenPlanDefinition(options.protocol);
  try {
    const listed = await fetchCompatibleEndpointModels({
      baseUrl: definition.baseUrl,
      apiKey: options.apiKey,
      protocol: definition.protocol,
      fetchImpl: options.fetchImpl,
      signal: options.signal,
    });
    if (listed.length > 0) return overlayCatalog(listed);
  } catch {
    // Token Plan /models is not guaranteed on every protocol; fall back to the
    // documented coding-model catalog so setup still succeeds.
  }
  return catalogAsListedModels();
}

export function applyQwenTokenPlanConfig(
  config: ManagedKimiConfigShape,
  options: {
    readonly protocol: QwenTokenPlanProtocol;
    readonly apiKey: string;
    readonly models: readonly CompatibleListedModel[];
    readonly preserveDefaultModel?: boolean;
  },
): void {
  const definition = getQwenTokenPlanDefinition(options.protocol);
  applyCompatibleEndpointConfig(config, {
    providerId: definition.providerId,
    displayName: definition.displayName,
    protocol: definition.protocol,
    baseUrl: definition.baseUrl,
    apiKey: options.apiKey,
    models: overlayCatalog(options.models),
    preserveDefaultModel: options.preserveDefaultModel,
  });
  const provider = config.providers[definition.providerId];
  if (provider !== undefined) {
    config.providers[definition.providerId] = {
      ...provider,
      source: { kind: 'qwenTokenPlan', protocol: options.protocol },
    };
  }
}

export function isQwenTokenPlanSource(
  value: unknown,
): value is { readonly kind: 'qwenTokenPlan'; readonly protocol: QwenTokenPlanProtocol } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly kind?: unknown; readonly protocol?: unknown };
  return (
    candidate.kind === 'qwenTokenPlan' &&
    (candidate.protocol === 'openai' || candidate.protocol === 'anthropic')
  );
}
