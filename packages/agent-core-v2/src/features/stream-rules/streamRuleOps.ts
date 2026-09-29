/**
 * `stream-rules` domain — wire Model (`StreamRuleModel`) and the
 * `streamRule.injected` (`streamRuleInjected`) Op.
 *
 * Records each injected rule name as a persisted, replayable fact so session
 * replays and post-compaction summaries keep the knowledge that guidance was
 * given (mirroring oh-my-pi's `ttsr_injection{injectedRules}` jsonl entries).
 * The names list is append-only and deduped; each `apply` returns the same
 * reference on a no-op so the wire's reference-equality gate stays quiet.
 * Stays on the static import=register channel so records remain replayable
 * even when the feature unit is retracted.
 */

import { z } from 'zod';

import { defineCheckpointedModel } from '#/agent/contextMemory/conversationTime';

export interface StreamRuleState {
  readonly injectedNames: readonly string[];
}

export const StreamRuleModel = defineCheckpointedModel('streamRule', (): StreamRuleState => ({
  injectedNames: [],
}));

declare module '#/wire/types' {
  interface PersistedOpMap {
    'streamRule.injected': typeof streamRuleInjected;
  }
}

export const streamRuleInjected = StreamRuleModel.defineOp('streamRule.injected', {
  schema: z.object({ names: z.array(z.string()) }),
  apply: (s, p) => {
    const known = new Set(s.current.injectedNames);
    const fresh = p.names.filter((name) => !known.has(name));
    if (fresh.length === 0) return s;
    return { ...s, current: { injectedNames: [...s.current.injectedNames, ...fresh] } };
  },
});
