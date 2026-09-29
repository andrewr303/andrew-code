import { z } from 'zod';

import type { BuiltinTool } from '../../../agent/tool';
import { ToolAccesses } from '../../../loop/tool-access';
import type { ExecutableToolContext, ExecutableToolResult, ToolExecution } from '../../../loop/types';
import {
  detectExternalClis,
  formatFusionPanelReport,
  isScriptMode,
  resolveFusionScriptsRoot,
  runFusionPanel,
  runFusionScript,
  scriptFormCommand,
  type ExternalCliId,
  type FusionMode,
} from '../../../external-cli';
import { toInputJsonSchema } from '../../support/input-schema';
import FUSION_DESCRIPTION from './fusion.md?raw';

const PROVIDER_ENUM = z.enum([
  'claude',
  'codex',
  'copilot',
  'opencode',
  'grok',
  'kimi',
  'andrewcode',
]);

const MODE_ENUM = z.enum([
  'detect',
  'solo',
  'panel',
  'council',
  'debate',
  'vote',
  'swarm',
  'graph',
  'hive',
  'designer',
  'metaloop',
  'ultracode',
  'ultraswarm',
  'board',
  'context',
]);

const BOARD_VERB_ENUM = z.enum(['init', 'agents', 'poll', 'channels', 'tree', 'mentions']);

const CONTEXT_ACTION_ENUM = z.enum(['list', 'get', 'set', 'clear', 'snapshot']);

export const FusionToolInputSchema = z
  .object({
    mode: MODE_ENUM.optional().describe(
      'Fusion collaboration mode. Default panel. Use detect to probe CLI availability without dispatch. Script-backed forms: graph, hive, designer, metaloop, ultracode, ultraswarm, board, context.',
    ),
    prompt: z
      .string()
      .trim()
      .optional()
      .describe(
        'Panel prompt. Required for every mode except detect, ultracode, designer, board, context, and ultraswarm (ultraswarm with no prompt runs --discover). Include the user task verbatim plus any local file excerpts panelists need (they cannot see this repo).',
      ),
    providers: z
      .array(PROVIDER_ENUM)
      .max(8)
      .optional()
      .describe('Optional explicit panelist list. Defaults to every available external CLI.'),
    pattern: z
      .enum(['moa', 'heavy', 'discuss', 'hierarchy', 'breaker', 'council', 'flow'])
      .optional()
      .describe('Swarm architecture pattern when mode is swarm.'),
    models: z
      .record(z.string(), z.string())
      .optional()
      .describe('Per-provider custom model overrides (e.g. { claude: "claude-3-7-sonnet", codex: "gpt-5.6-sol" }).'),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(1_800_000)
      .optional()
      .describe('Per-panelist timeout in milliseconds (default 900000).'),
    captains: z
      .array(PROVIDER_ENUM)
      .max(8)
      .optional()
      .describe('Captain providers for hive swarms (max 8).'),
    children_per_captain: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe('Number of child workers per captain (1..8).'),
    layers: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe('Number of layers for layered swarm patterns (1..4).'),
    dry_run: z
      .boolean()
      .optional()
      .describe('Dry run / plan-only mode without executing.'),
    verb: z
      .enum(['doctor', 'test', 'launch', 'status', 'install'])
      .optional()
      .describe('Subcommand verb for ultracode mode.'),
    plan_file: z
      .string()
      .trim()
      .optional()
      .describe('Plan file path for metaloop mode.'),
    thinking_effort: z
      .string()
      .trim()
      .optional()
      .describe('Thinking / effort hint persisted as thinking_effort (e.g. low, medium, high, xhigh).'),
    board_verb: BOARD_VERB_ENUM.optional().describe(
      'Hive Board verb when mode is board (default agents).',
    ),
    board_db: z
      .string()
      .trim()
      .optional()
      .describe('Hive Board sqlite path when mode is board (--db).'),
    context_action: CONTEXT_ACTION_ENUM.optional().describe(
      'Agency-context action when mode is context (default list).',
    ),
    context_key: z
      .string()
      .trim()
      .optional()
      .describe('Agency-context key for get/set/clear.'),
    context_value: z
      .string()
      .optional()
      .describe('Agency-context value when context_action is set.'),
  })
  .strict();

export type FusionToolInput = z.infer<typeof FusionToolInputSchema>;

const FUSION_PARAMETERS = toInputJsonSchema(FusionToolInputSchema);

export class FusionTool implements BuiltinTool<FusionToolInput> {
  readonly name = 'Fusion' as const;
  readonly description = FUSION_DESCRIPTION;
  readonly parameters: Record<string, unknown> = FUSION_PARAMETERS;

  resolveExecution(args: FusionToolInput): ToolExecution {
    const mode = (args.mode ?? 'panel') as FusionMode;
    return {
      accesses: ToolAccesses.all(),
      description:
        mode === 'detect' ? 'Probe external CLI panelists' : `Fusion ${mode} dispatch`,
      display: {
        kind: 'generic',
        summary: mode === 'detect' ? 'Fusion detect' : `Fusion ${mode}`,
      },
      approvalRule: this.name,
      execute: (ctx) => this.execution(args, ctx),
    };
  }

  private async execution(
    args: FusionToolInput,
    ctx: ExecutableToolContext,
  ): Promise<ExecutableToolResult> {
    const mode = (args.mode ?? 'panel') as FusionMode;

    if (mode === 'detect' || mode === 'solo') {
      const detect = detectExternalClis();
      const report = formatFusionPanelReport({
        mode,
        host: detect.host,
        panel: [],
        returned: 0,
        absent: 0,
        ms: 0,
      });
      return { output: report };
    }

    if (args.models) {
      if (args.models['codex']) process.env['FUSION_CODEX_MODEL'] = args.models['codex'];
      if (args.models['claude']) process.env['FUSION_CLAUDE_MODEL'] = args.models['claude'];
      if (args.models['grok']) process.env['FUSION_GROK_MODEL'] = args.models['grok'];
      if (args.models['copilot']) process.env['FUSION_COPILOT_MODEL'] = args.models['copilot'];
      if (args.models['opencode']) process.env['FUSION_OPENCODE_MODEL'] = args.models['opencode'];
      if (args.models['kimi'] || args.models['andrewcode']) {
        process.env['FUSION_KIMI_MODEL'] = args.models['kimi'] ?? args.models['andrewcode'];
      }
    }

    if (isScriptMode(mode)) {
      const scriptsRoot = resolveFusionScriptsRoot();
      if (!scriptsRoot) {
        return {
          output:
            `Fusion error: scripts bundle not found for mode "${mode}". ` +
            'Set FUSION_PLUGIN_ROOT to your fusion directory or install the fusion plugin.',
          isError: true,
        };
      }

      if (
        mode !== 'ultracode' &&
        mode !== 'designer' &&
        mode !== 'ultraswarm' &&
        mode !== 'board' &&
        mode !== 'context'
      ) {
        const prompt = args.prompt?.trim() ?? '';
        if (prompt.length === 0) {
          return {
            output:
              'Fusion error: `prompt` is required for mode ' +
              mode +
              '. Pass the user task (plus any local excerpts panelists need).',
            isError: true,
          };
        }
      }

      const cmd = scriptFormCommand({
        mode,
        prompt: args.prompt?.trim() ?? '',
        captains: args.captains as ExternalCliId[] | undefined,
        children_per_captain: args.children_per_captain,
        layers: args.layers,
        dry_run: args.dry_run,
        verb: args.verb,
        plan_file: args.plan_file,
        providers: args.providers as ExternalCliId[] | undefined,
        pattern: args.pattern,
        thinking_effort: args.thinking_effort,
        board_verb: args.board_verb,
        board_db: args.board_db,
        context_action: args.context_action,
        context_key: args.context_key,
        context_value: args.context_value,
      });

      const res = await runFusionScript({
        script: cmd.script,
        args: cmd.args,
        scriptsRoot,
        cwd: process.cwd(),
        timeoutMs: args.timeout_ms,
        signal: ctx.signal,
      });

      if (res.timedOut) {
        return {
          output: `Fusion error: script ${cmd.script} timed out after ${args.timeout_ms ?? 900_000}ms`,
          isError: true,
        };
      }

      if (res.exitCode !== 0) {
        const errText =
          res.stdout.trim() ||
          res.stderr.trim() ||
          `Fusion script failed with exit code ${res.exitCode}`;
        return {
          output: errText,
          isError: true,
        };
      }

      const outText = res.stdout.trim() || res.stderr.trim() || '(no output)';
      return { output: outText };
    }

    const prompt = args.prompt?.trim() ?? '';
    if (prompt.length === 0) {
      return {
        output:
          'Fusion error: `prompt` is required for mode ' +
          mode +
          '. Pass the user task (plus any local excerpts panelists need).',
        isError: true,
      };
    }

    const result = await runFusionPanel({
      mode,
      prompt,
      providers: args.providers as ExternalCliId[] | undefined,
      cwd: process.cwd(),
      timeoutMs: args.timeout_ms,
      signal: ctx.signal,
    });

    return { output: formatFusionPanelReport(result) };
  }
}
