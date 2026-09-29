/**
 * `kosong/provider` domain — QwenCloud Token Plan Responses helpers.
 *
 * Detects the Token Plan OpenAI-compatible base URL and maps model ids to
 * the hosted Harness tools the Responses API accepts as `{ type }` entries.
 */

export function isQwenTokenPlanResponsesBaseUrl(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || baseUrl.length === 0) return false;
  return baseUrl.includes('token-plan.maas.qwencloudapi.com/compatible-mode');
}

export function qwenHostedBuiltinToolsForModel(
  baseUrl: string | undefined,
  modelId: string,
): readonly string[] {
  if (!isQwenTokenPlanResponsesBaseUrl(baseUrl)) return [];
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
