/**
 * `tools` domain — `IFusionTool` contract (the `Fusion` tool).
 *
 * Public contract of the `Fusion` collaboration tool: blind parallel panel
 * over external coding CLIs plus the script-backed swarm forms (graph / hive /
 * designer / metaloop / ultracode / ultraswarm / board / context) routed
 * through the bundled Fusion plugin scripts. Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

const FUSION_PROVIDER_IDS = [
  'claude',
  'codex',
  'copilot',
  'opencode',
  'grok',
  'kimi',
  'andrewcode',
] as const;

const FUSION_MODES = [
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
] as const;

export const FusionInputSchema = z
  .object({
    mode: z
      .enum(FUSION_MODES)
      .optional()
      .describe(
        'Fusion collaboration mode. Default panel. Use detect to probe CLI availability without dispatch. Script-backed forms: graph (typed-node DAG), hive (nested Hive Board swarm), designer (topology catalog / design prompt, never dispatches), metaloop (plan-and-execute scaffold), ultracode (UltraCode shim doctor/test/launch/status/install), ultraswarm (five-agent council via ultraswarm.sh), board (Hive Board inspect/post/poll), context (agency-context get/set/list/clear/snapshot).',
      ),
    prompt: z
      .string()
      .trim()
      .optional()
      .describe(
        'Panel prompt. Required for every mode except detect, ultracode, ultraswarm (falls back to --discover), board, and context. Include the user task verbatim plus any local file excerpts panelists need (they cannot see this repo).',
      ),
    providers: z
      .array(z.enum(FUSION_PROVIDER_IDS))
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
      .array(z.enum(FUSION_PROVIDER_IDS))
      .max(8)
      .optional()
      .describe('Comma-joined captain provider list for mode hive (defaults to the hive engine defaults when omitted).'),
    children_per_captain: z
      .number()
      .int()
      .min(1)
      .max(8)
      .optional()
      .describe('Hive workers per captain (default 4).'),
    layers: z
      .number()
      .int()
      .min(1)
      .max(4)
      .optional()
      .describe('Layered swarm depth for script-backed swarm patterns (e.g. moa layers).'),
    dry_run: z
      .boolean()
      .optional()
      .describe('Plan without dispatching: graph --plan lint/schedule/cost, hive --dry-run board-only.'),
    verb: z
      .enum(['doctor', 'test', 'launch', 'status', 'install'])
      .optional()
      .describe('Ultracode verb when mode is ultracode (default doctor).'),
    plan_file: z
      .string()
      .trim()
      .optional()
      .describe('Path to a MetaLoop plan JSON (TaskSpec list) for mode metaloop.'),
    spec: z
      .string()
      .trim()
      .optional()
      .describe('Path to a graph JSON spec (typed nodes, budget, repeat) for mode graph.'),
    thinking_effort: z
      .string()
      .trim()
      .optional()
      .describe('Optional thinking/effort hint persisted with the swarm form (e.g. low, medium, high, xhigh).'),
    board_verb: z
      .enum(['init', 'agents', 'poll', 'channels', 'tree', 'mentions'])
      .optional()
      .describe('Hive Board CLI verb when mode is board (default agents).'),
    board_db: z
      .string()
      .trim()
      .optional()
      .describe('Path to the Hive Board sqlite file (`--db`) when mode is board.'),
    context_action: z
      .enum(['list', 'get', 'set', 'clear', 'snapshot'])
      .optional()
      .describe('Agency-context action when mode is context (default list).'),
    context_key: z
      .string()
      .trim()
      .optional()
      .describe('Agency-context key for get/set/clear when mode is context.'),
    context_value: z
      .string()
      .optional()
      .describe('Agency-context value for set when mode is context.'),
  })
  .strict();

export type FusionToolInput = z.infer<typeof FusionInputSchema>;

export interface IFusionTool extends AgentTool<FusionToolInput> {
  readonly _serviceBrand: undefined;
}
export const IFusionTool = createDecorator<IFusionTool>('fusionTool');