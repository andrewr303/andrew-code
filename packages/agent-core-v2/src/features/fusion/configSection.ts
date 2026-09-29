/**
 * `fusion` domain — the `[fusion]` config section.
 *
 * Preserves the opt-in legacy lead/sidekick pairing and its compaction
 * routing preference. Explicit session team commands use separate CEO,
 * COO, worker, idiot-boss coordinator and consultant aliases with validated
 * effort settings; they do not require the global legacy `enabled`
 * preference. Default roles: Astra CEO, Opus COO (principal engineer /
 * persistent implementer), Flash worker and Luna coordinator. Also owns
 * the script-bridge settings consumed by the `Fusion` tool: the bundled
 * plugin scripts root and the panel dispatch timeout. Stays on
 * the static import=register channel for manifest discovery. App scope.
 */

import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const FUSION_SECTION = 'fusion';

export const FusionConfigSchema = z.object({
  enabled: z.boolean().optional(),
  leadModel: z.string().optional(),
  sidekickModel: z.string().optional(),
  routing: z.boolean().optional(),
  ceoModel: z.string().min(1).optional(),
  cooModel: z.string().min(1).optional(),
  workerModel: z.string().min(1).optional(),
  coordinatorModel: z.string().min(1).optional(),
  museModel: z.string().min(1).optional(),
  terraModel: z.string().min(1).optional(),
  ceoEffort: z.string().min(1).optional(),
  cooEffort: z.string().min(1).optional(),
  workerEffort: z.string().min(1).optional(),
  coordinatorEffort: z.string().min(1).optional(),
  museEffort: z.string().min(1).optional(),
  terraEffort: z.string().min(1).optional(),
  claudeModel: z.string().min(1).optional(),
  maxWorkers: z.number().int().min(1).max(8).optional(),
  scriptsRoot: z.string().min(1).optional(),
  panelTimeoutMs: z.number().int().min(1_000).max(1_800_000).optional(),
});

export type FusionConfig = z.infer<typeof FusionConfigSchema>;

export const DEFAULT_FUSION_LEAD_MODEL = 'gpt-6-astra';
export const DEFAULT_FUSION_SIDEKICK_MODEL = 'cloudflare-workers-ai/@cf/zai-org/glm-5.3-flash';

export const DEFAULT_FUSION_CONFIG: Required<Omit<FusionConfig, 'scriptsRoot'>> = {
  enabled: false,
  leadModel: DEFAULT_FUSION_LEAD_MODEL,
  sidekickModel: DEFAULT_FUSION_SIDEKICK_MODEL,
  routing: true,
  ceoModel: 'gpt-6-astra',
  cooModel: 'claude-opus-5-5',
  workerModel: 'gemini-3.8-flash',
  coordinatorModel: 'gpt-6-luna',
  museModel: 'muse-spark-1.3',
  terraModel: 'gpt-5.6-terra',
  ceoEffort: 'xhigh',
  cooEffort: 'xhigh',
  workerEffort: 'high',
  coordinatorEffort: 'high',
  museEffort: 'max',
  terraEffort: 'xhigh',
  claudeModel: 'claude-opus-5-5',
  maxWorkers: 4,
  panelTimeoutMs: 900_000,
};

registerConfigSection(FUSION_SECTION, FusionConfigSchema, {
  defaultValue: DEFAULT_FUSION_CONFIG,
});
