/**
 * `kosong/provider` domain — side-effect module: registers the OpenAI
 * Responses base (`id: 'openai_responses'`).
 *
 * The factory aggregates the endpoint, applies `provides` under explicit
 * config, composes headers — and passes `apiKey ?? ''` to suppress the
 * base's `OPENAI_API_KEY` environment fallback once a trait declared an
 * endpoint.
 */

import { registerProtocolBase } from '#/kosong/protocol/protocolBase';
import { traitConvertError, traitDefaultHeaders } from '#/kosong/protocol/protocolTrait';

import { getOpenAIResponsesModelCapability, OpenAIResponsesChatProvider } from './openai-responses';
import {
  CODEX_BETA_FEATURES_HEADER,
  CODEX_REMOTE_COMPACTION_V2_FEATURE,
  isCodexResponsesBaseUrl,
} from './codex-responses';
import { compactObject, firstProcessEnv, traitEndpoint, traitProvides } from './openaiHooks';
import { qwenHostedBuiltinToolsForModel } from './qwen-responses';

registerProtocolBase({
  id: 'openai_responses',
  capability: getOpenAIResponsesModelCapability,
  createChatProvider({ config, traits }) {
    const endpoint = traitEndpoint(traits);
    const baseUrl =
      config.baseUrl ?? firstProcessEnv(endpoint?.baseUrlEnv) ?? endpoint?.defaultBaseUrl;
    const traitHeaders = traitDefaultHeaders(traits) ?? {};
    const defaultHeaders = isCodexResponsesBaseUrl(baseUrl)
      ? { ...traitHeaders, [CODEX_BETA_FEATURES_HEADER]: CODEX_REMOTE_COMPACTION_V2_FEATURE }
      : traitHeaders;
    const hostedBuiltinTools = qwenHostedBuiltinToolsForModel(baseUrl, config.modelName);
    return new OpenAIResponsesChatProvider({
      ...(traitProvides(traits) as Partial<
        ConstructorParameters<typeof OpenAIResponsesChatProvider>[0]
      >),
      model: config.modelName,
      ...compactObject({
        apiKey:
          config.apiKey ??
          firstProcessEnv(endpoint?.apiKeyEnv) ??
          (endpoint === undefined ? undefined : ''),
        baseUrl,
        defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
        maxOutputTokens: config.providerOptions?.defaultMaxTokens,
        offEffort: config.providerOptions?.offEffort,
        convertError: traitConvertError(traits),
        hostedBuiltinTools: hostedBuiltinTools.length > 0 ? hostedBuiltinTools : undefined,
      }),
    });
  },
});
