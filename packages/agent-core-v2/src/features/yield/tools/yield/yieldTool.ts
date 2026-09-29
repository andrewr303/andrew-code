/**
 * `yield` domain — `IYieldTool` implementation.
 *
 * Validates the payload against the parent-declared schema (`schemaFor`
 * the caller's own agent id) with AJV and stores it in the session yield
 * slot: success as `{ data }`, failure as `{ error }`, plus the optional
 * `type` label. Schema violations are retried in-tool up to three times
 * (the error message carries the validation detail so the model can fix
 * the payload); after that the payload is accepted anyway with
 * `schemaOverridden: true` so the parent's finalizer — not the child —
 * decides (oh-my-pi's override-flag behavior). Yielding ends the turn
 * (`stopTurn: true`). Bound at Agent scope.
 */

import Ajv, { type ValidateFunction } from 'ajv';

import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';

import DESCRIPTION from './yield.md?raw';
import { ISessionYieldService } from '../../yield';
import { IYieldTool, YieldToolInputSchema, type YieldToolInput } from './yield';

const MAX_SCHEMA_RETRIES = 3;

export class YieldTool implements IYieldTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Yield' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(YieldToolInputSchema);

  private readonly ajv = new Ajv({ allErrors: true, strict: false });

  constructor(
    @ISessionYieldService private readonly yields: ISessionYieldService,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
  ) {}

  resolveExecution(args: YieldToolInput): ToolExecution {
    return {
      description: 'Submitting structured subagent result',
      approvalRule: this.name,
      execute: async () => {
        if (args.error !== undefined && args.error.trim().length > 0) {
          this.yields.submit(this.scopeContext.agentId, {
            error: args.error,
            type: args.type,
          });
          return { output: 'Failure recorded.', stopTurn: true };
        }
        if (args.data === undefined) {
          return {
            isError: true,
            output: 'Submit success as {"data": <your output>} or failure as {"error": "message"}.',
          };
        }
        const schema = this.yields.schemaFor(this.scopeContext.agentId);
        let schemaOverridden = false;
        if (schema !== undefined) {
          const verdict = this.checkSchema(schema, args.data);
          if (verdict === 'retry') {
            return { isError: true, output: `Payload does not satisfy the output schema:\n${this.lastIssues}\nFix the payload and call Yield again.` };
          }
          schemaOverridden = verdict === 'override';
        }
        this.yields.submit(this.scopeContext.agentId, {
          data: args.data,
          type: args.type,
          ...(schemaOverridden ? { schemaOverridden: true as const } : {}),
        });
        return {
          output: schemaOverridden
            ? 'Result recorded with a schema override flag; the parent will re-check it.'
            : 'Result recorded.',
          stopTurn: true,
        };
      },
    };
  }

  private checkSchema(schema: Record<string, unknown>, data: unknown): 'ok' | 'retry' | 'override' {
    let validate: ValidateFunction;
    try {
      validate = this.ajv.compile(schema);
    } catch {
      return 'ok';
    }
    if (validate(data)) {
      this.attempts.delete(this.scopeContext.agentId);
      return 'ok';
    }
    const attempts = (this.attempts.get(this.scopeContext.agentId) ?? 0) + 1;
    this.attempts.set(this.scopeContext.agentId, attempts);
    if (attempts >= MAX_SCHEMA_RETRIES) {
      this.attempts.delete(this.scopeContext.agentId);
      return 'override';
    }
    const detail = (validate.errors ?? [])
      .map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
      .join('; ');
    this.lastIssues = detail || 'invalid payload';
    return 'retry';
  }

  private lastIssues = '';
  private readonly attempts = new Map<string, number>();
}
