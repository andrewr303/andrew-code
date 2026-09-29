import { z } from 'zod';

import { registerConfigSection } from '#/app/config/configSectionContributions';

export const ANDREW_SECTION = 'andrew';

export const AndrewSectionSchema = z.object({
  codeMode: z.enum(['direct', 'code_mode', 'code_mode_only']).optional(),
  remoteCompactionV2: z.boolean().optional(),
  perplexitySearch: z.boolean().optional(),
});

export type AndrewSection = z.infer<typeof AndrewSectionSchema>;

registerConfigSection(ANDREW_SECTION, AndrewSectionSchema, {
  defaultValue: {
    codeMode: 'direct',
    remoteCompactionV2: true,
    perplexitySearch: false,
  },
});
