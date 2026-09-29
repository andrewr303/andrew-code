/**
 * `yield` domain — `ISessionYieldService` implementation.
 *
 * Plain in-memory slot map keyed by agent id: `declareSchema` records the
 * parent's expectation, `submit` stores the child's validated payload,
 * `take` consumes it exactly once. No persistence, no wire — payloads are
 * turn-scoped handoffs, and a restart drops whatever was unclaimed.
 * Session scope — contributed by `YieldFeature`
 * (`features/yield/yieldFeature`).
 */

import { Service } from '#/_base/di/service';

import { ISessionYieldService, type YieldPayload } from './yield';

export class SessionYieldService extends Service implements ISessionYieldService {
  declare readonly _serviceBrand: undefined;

  private readonly schemas = new Map<string, Record<string, unknown>>();
  private readonly slots = new Map<string, YieldPayload>();

  declareSchema(agentId: string, schema: Record<string, unknown>): void {
    this.schemas.set(agentId, schema);
  }

  schemaFor(agentId: string): Record<string, unknown> | undefined {
    return this.schemas.get(agentId);
  }

  submit(agentId: string, payload: YieldPayload): void {
    this.slots.set(agentId, payload);
  }

  take(agentId: string): YieldPayload | undefined {
    const payload = this.slots.get(agentId);
    if (payload !== undefined) this.slots.delete(agentId);
    return payload;
  }

  peek(agentId: string): YieldPayload | undefined {
    return this.slots.get(agentId);
  }
}
