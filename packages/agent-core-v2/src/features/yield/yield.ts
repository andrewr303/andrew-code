/**
 * `yield` domain — `ISessionYieldService` contract.
 *
 * Structured subagent yield (oh-my-pi's `Yield` tool + FrontierAgent's
 * report schema): a parent declares a JSON Schema via the `Agent` tool's
 * `outputSchema` parameter; the child validates its payload through the
 * `Yield` tool and the slot holds it for the parent to read directly — no
 * prose to parse. Entries are transient (never touch the wire): a session
 * restart drops unclaimed payloads, and `take` removes the entry so each
 * payload is consumed exactly once. Session scope — one slot map per
 * session, contributed by `YieldFeature`
 * (`features/yield/yieldFeature`).
 */

import { createDecorator } from '#/_base/di/instantiation';

export interface YieldPayload {
  readonly data?: unknown;
  readonly error?: string;
  readonly type?: string | readonly string[];
  readonly schemaOverridden?: boolean;
}

export interface ISessionYieldService {
  readonly _serviceBrand: undefined;

  /** Declare the schema a not-yet-yielded agent must satisfy (parent side). */
  declareSchema(agentId: string, schema: Record<string, unknown>): void;

  /** Schema declared for an agent, if any. */
  schemaFor(agentId: string): Record<string, unknown> | undefined;

  /** Store a validated payload for an agent (child `Yield` tool side). */
  submit(agentId: string, payload: YieldPayload): void;

  /** Consume and remove an agent's payload, if present. */
  take(agentId: string): YieldPayload | undefined;

  /** Peek without consuming. */
  peek(agentId: string): YieldPayload | undefined;
}

export const ISessionYieldService = createDecorator<ISessionYieldService>('sessionYieldService');
