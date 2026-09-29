/**
 * `dap` domain — `IDebugTool` implementation.
 *
 * Maps the tool's command vocabulary onto `IDebugService`: launch/attach
 * start sessions, stop disposes them, and every other command forwards to
 * the live session's DAP request with the mapped arguments
 * (`set_breakpoints` builds the source/lines payload, `stack_trace` and
 * `variables` take their handles from the args, `evaluate` carries the
 * frame). The result body renders as JSON so the model reads frames and
 * variables directly. Bound at Agent scope.
 */

import type { ToolExecution } from '#/tool/toolContract';
import { toInputJsonSchema } from '#/tool/input-schema';
import { ToolAccesses } from '#/tool/toolContract';
import { IFlagService } from '#/app/flag/flag';

import DESCRIPTION from './debug.md?raw';
import { DEBUG_DAP_FLAG_ID } from '../../flag';
import { IDebugService } from '../../debug';
import { IDebugTool, DebugToolInputSchema, type DebugToolInput } from './debug';

export class DebugTool implements IDebugTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'Debug' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(DebugToolInputSchema);

  constructor(
    @IDebugService private readonly debug: IDebugService,
    @IFlagService private readonly flags: IFlagService,
  ) {}

  resolveExecution(args: DebugToolInput): ToolExecution {
    return {
      description: `Debug ${args.command}${args.session !== undefined ? ` (${args.session})` : ''}`,
      accesses: ToolAccesses.all(),
      approvalRule: this.name,
      execute: async () => {
        if (!this.flags.enabled(DEBUG_DAP_FLAG_ID)) {
          return {
            isError: true,
            output: 'The Debug tool is experimental. Enable it via KIMI_CODE_EXPERIMENTAL_DEBUG_DAP or the [experimental] config section.',
          };
        }
        const session = args.session ?? 'default';
        switch (args.command) {
          case 'launch':
          case 'attach': {
            const result = await this.debug.start(session, {
              kind: args.command,
              program: args.program,
              args: args.args,
              pid: args.pid,
              stopOnEntry: args.stop_on_entry,
            });
            return render(result.body);
          }
          case 'stop': {
            await this.debug.stop(session);
            return { output: `Debug session "${session}" stopped.` };
          }
          case 'set_breakpoints': {
            if (args.path === undefined) return missing('path');
            const result = await this.debug.command(session, 'setBreakpoints', {
              source: { path: args.path },
              lines: args.breakpoints ?? [],
              breakpoints: (args.breakpoints ?? []).map((line) => ({ line })),
            });
            return render(result.body);
          }
          case 'step_over': {
            const result = await this.debug.command(session, 'next', { threadId: 1 });
            return render(result.body);
          }
          case 'step_in': {
            const result = await this.debug.command(session, 'stepIn', { threadId: 1 });
            return render(result.body);
          }
          case 'step_out': {
            const result = await this.debug.command(session, 'stepOut', { threadId: 1 });
            return render(result.body);
          }
          case 'continue': {
            const result = await this.debug.command(session, 'continue', { threadId: 1 });
            return render(result.body);
          }
          case 'pause': {
            const result = await this.debug.command(session, 'pause', { threadId: 1 });
            return render(result.body);
          }
          case 'stack_trace': {
            const result = await this.debug.command(session, 'stackTrace', {
              threadId: 1,
              startFrame: 0,
              levels: 20,
            });
            return render(result.body);
          }
          case 'scopes': {
            if (args.frame === undefined) return missing('frame');
            const result = await this.debug.command(session, 'scopes', { frameId: args.frame });
            return render(result.body);
          }
          case 'variables': {
            if (args.variables_reference === undefined) return missing('variables_reference');
            const result = await this.debug.command(session, 'variables', {
              variablesReference: args.variables_reference,
            });
            return render(result.body);
          }
          case 'evaluate': {
            if (args.expression === undefined) return missing('expression');
            const result = await this.debug.command(session, 'evaluate', {
              expression: args.expression,
              frameId: args.frame,
            });
            return render(result.body);
          }
          case 'threads': {
            const result = await this.debug.command(session, 'threads', {});
            return render(result.body);
          }
          default: {
            return { isError: true, output: `Unknown debug command.` };
          }
        }
      },
    };
  }
}

function render(body: unknown): { output: string; isError?: boolean } {
  const body_ = body as { error?: string } | undefined;
  if (body_ !== null && typeof body_ === 'object' && typeof body_['error'] === 'string') {
    return { output: String(body_['error']), isError: true };
  }
  const json = safeJson(body);
  return { output: json === undefined ? '(no result)' : json };
}

function missing(param: string): { output: string; isError: true } {
  return { isError: true, output: `Missing required parameter "${param}".` };
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2) ?? undefined;
  } catch {
    return '[unserializable result]';
  }
}
