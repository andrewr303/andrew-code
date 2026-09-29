/**
 * `auth` domain (cross-cutting) — Perplexity `WebSearch` backends.
 *
 * Adapts the two non-Moonshot search sources owned by
 * `@moonshot-ai/kimi-code-oauth` to the `WebSearchProvider` contract: the
 * Perplexity API-key search and the `pwm` session search. Both are plain
 * classes constructed by `WebSearchProviderService`, mirroring
 * `MoonshotWebSearchProvider`.
 */

import {
  hasPwmSession,
  perplexityApiKey,
  searchPerplexity,
  searchPwmSession,
} from '@moonshot-ai/kimi-code-oauth';

import type { WebSearchProvider, WebSearchResult } from '#/agent/tools/web-search/web-search';

export function hasPerplexityApiKey(): boolean {
  return perplexityApiKey() !== undefined;
}

export function hasPerplexitySession(): boolean {
  return hasPwmSession();
}

export class PerplexityApiWebSearchProvider implements WebSearchProvider {
  async search(query: string): Promise<WebSearchResult[]> {
    const hits = await searchPerplexity({ query });
    return hits.map((hit): WebSearchResult => {
      const out: WebSearchResult = {
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
      };
      if (hit.date !== undefined) out.date = hit.date;
      return out;
    });
  }
}

export class PwmSessionWebSearchProvider implements WebSearchProvider {
  async search(query: string): Promise<WebSearchResult[]> {
    const hits = await searchPwmSession({ query });
    return hits.map((hit): WebSearchResult => {
      const out: WebSearchResult = {
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
      };
      if (hit.date !== undefined) out.date = hit.date;
      return out;
    });
  }
}
