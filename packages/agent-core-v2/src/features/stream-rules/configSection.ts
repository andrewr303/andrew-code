/**
 * `stream-rules` domain — registers the `streamRules` config section into
 * `config`.
 *
 * Single `enabled` preference (`stream_rules.enabled` on disk, default on):
 * when false the service loads no rules and every check is a no-op. Stays on
 * the static import=register channel (not the Feature's runtime contribution)
 * so the section remains statically discoverable — the config manifest
 * generator drains the module-level table. Bound at App scope.
 */

import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const STREAM_RULES_SECTION = 'streamRules';

export const StreamRulesConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .optional();

export type StreamRulesConfig = z.infer<typeof StreamRulesConfigSchema>;

registerConfigSection(STREAM_RULES_SECTION, StreamRulesConfigSchema, {
  defaultValue: { enabled: true },
});
