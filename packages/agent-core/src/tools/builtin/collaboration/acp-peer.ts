import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { runAcpSession } from '../../../external-cli/acp-session';
import type { ExternalCliId } from '../../../external-cli/types';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import { toInputJsonSchema } from '../../support/input-schema';

export const ACP_PEER_TOOL_NAME = 'AcpPeer';

const PROVIDER_ENUM = z.enum(['claude', 'codex', 'copilot', 'opencode', 'grok', 'kimi', 'andrewcode']);

export const AcpPeerInputSchema = z
  .object({
    provider: PROVIDER_ENUM.describe('ACP-speaking CLI to spawn.'),
    prompt: z.string().trim().min(1).describe('Prompt to send to the peer agent.'),
    timeout_ms: z.number().int().positive().max(1_800_000).optional(),
  })
  .strict();

export type AcpPeerInput = z.infer<typeof AcpPeerInputSchema>;

export class AcpPeerTool implements BuiltinTool<AcpPeerInput> {
  readonly name = ACP_PEER_TOOL_NAME;
  readonly description =
    'Spawn another coding CLI over the Agent Client Protocol (ACP) and run one prompt. Use for live peer agents (claude, grok, opencode, andrewcode). Fusion remains the multi-model panel; this is a single ACP session.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(AcpPeerInputSchema);

  resolveExecution(args: AcpPeerInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      description: `ACP ${args.provider}`,
      display: { kind: 'generic', summary: `ACP ${args.provider}` },
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(args: AcpPeerInput, ctx: ExecutableToolContext): Promise<ExecutableToolResult> {
    const result = await runAcpSession({
      provider: args.provider as ExternalCliId,
      prompt: args.prompt,
      cwd: process.cwd(),
      timeoutMs: args.timeout_ms,
      signal: ctx.signal,
    });
    if (!result.usedAcp || result.output.trim().length === 0) {
      return {
        output: result.error ?? `ACP peer ${args.provider} produced no output. Try Fusion as a fallback.`,
        isError: true,
      };
    }
    return { output: result.output };
  }
}
