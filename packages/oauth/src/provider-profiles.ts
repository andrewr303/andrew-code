/**
 * Provider identity, wire dialect, and isolation policy.
 *
 * Identity comes from this profile — never from a model slug or URL.
 * Selecting Responses does not grant Codex OAuth; selecting Codex does not
 * override an explicit model API key.
 */

export type ApiBackend = 'chat_completions' | 'responses' | 'messages';

export type ProviderProfileId =
  | 'xai'
  | 'codex'
  | 'kimi-code'
  | 'kimi-platform'
  | 'claude'
  | 'perplexity'
  | 'qwen-token-plan'
  | 'unknown';

export type HostedSearchDialect = 'none' | 'xai' | 'openai';

export type CodeMode = 'direct' | 'code_mode' | 'code_mode_only';

export interface ProviderProfile {
  readonly id: ProviderProfileId;
  readonly displayName: string;
  readonly backends: readonly ApiBackend[];
  readonly hostedSearch: HostedSearchDialect;
  readonly nativeWebSearch: boolean;
  readonly allowsPerplexityFallback: boolean;
  readonly allowsXaiExports: boolean;
  readonly sessionCredential: 'xai' | 'codex-oauth' | 'kimi-code-oauth' | 'api-key' | 'none';
}

export const PROVIDER_PROFILES: Readonly<Record<ProviderProfileId, ProviderProfile>> = {
  xai: {
    id: 'xai',
    displayName: 'xAI Grok',
    backends: ['chat_completions', 'responses', 'messages'],
    hostedSearch: 'xai',
    nativeWebSearch: true,
    allowsPerplexityFallback: false,
    allowsXaiExports: true,
    sessionCredential: 'xai',
  },
  codex: {
    id: 'codex',
    displayName: 'ChatGPT Codex',
    backends: ['responses'],
    hostedSearch: 'openai',
    nativeWebSearch: true,
    allowsPerplexityFallback: false,
    allowsXaiExports: false,
    sessionCredential: 'codex-oauth',
  },
  'kimi-code': {
    id: 'kimi-code',
    displayName: 'Kimi Code',
    backends: ['chat_completions', 'messages'],
    hostedSearch: 'none',
    nativeWebSearch: false,
    allowsPerplexityFallback: true,
    allowsXaiExports: false,
    sessionCredential: 'kimi-code-oauth',
  },
  'kimi-platform': {
    id: 'kimi-platform',
    displayName: 'Kimi Platform',
    backends: ['chat_completions'],
    hostedSearch: 'none',
    nativeWebSearch: false,
    allowsPerplexityFallback: true,
    allowsXaiExports: false,
    sessionCredential: 'api-key',
  },
  claude: {
    id: 'claude',
    displayName: 'Claude Code',
    backends: ['messages'],
    hostedSearch: 'none',
    nativeWebSearch: false,
    allowsPerplexityFallback: false,
    allowsXaiExports: false,
    sessionCredential: 'none',
  },
  perplexity: {
    id: 'perplexity',
    displayName: 'Perplexity',
    backends: ['messages'],
    hostedSearch: 'none',
    nativeWebSearch: true,
    allowsPerplexityFallback: false,
    allowsXaiExports: false,
    sessionCredential: 'none',
  },
  'qwen-token-plan': {
    id: 'qwen-token-plan',
    displayName: 'QwenCloud Token Plan',
    backends: ['responses', 'messages'],
    hostedSearch: 'none',
    nativeWebSearch: true,
    allowsPerplexityFallback: false,
    allowsXaiExports: false,
    sessionCredential: 'api-key',
  },
  unknown: {
    id: 'unknown',
    displayName: 'Unknown',
    backends: ['chat_completions'],
    hostedSearch: 'none',
    nativeWebSearch: false,
    allowsPerplexityFallback: false,
    allowsXaiExports: false,
    sessionCredential: 'api-key',
  },
};

export function profileForProviderName(providerName: string | undefined): ProviderProfile {
  if (providerName === undefined || providerName.length === 0) return PROVIDER_PROFILES.unknown;
  if (providerName === 'codex' || providerName.startsWith('codex:')) return PROVIDER_PROFILES.codex;
  if (providerName === 'xai' || providerName.startsWith('xai:')) return PROVIDER_PROFILES.xai;
  if (providerName === 'perplexity' || providerName.startsWith('perplexity:')) {
    return PROVIDER_PROFILES.perplexity;
  }
  if (providerName === 'managed:kimi-code' || providerName === 'kimi-code') {
    return PROVIDER_PROFILES['kimi-code'];
  }
  if (providerName === 'moonshot-cn' || providerName === 'moonshot-ai' || providerName === 'kimi-platform') {
    return PROVIDER_PROFILES['kimi-platform'];
  }
  if (providerName === 'qwen-token-plan' || providerName.startsWith('qwen-token-plan')) {
    return PROVIDER_PROFILES['qwen-token-plan'];
  }
  return PROVIDER_PROFILES.unknown;
}

export function searchDialectForProfile(profile: ProviderProfile): HostedSearchDialect {
  return profile.hostedSearch;
}

export function canUsePerplexityFallback(profile: ProviderProfile): boolean {
  return profile.allowsPerplexityFallback;
}
