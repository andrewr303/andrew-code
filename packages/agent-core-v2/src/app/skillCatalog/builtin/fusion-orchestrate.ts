/**
 * `skillCatalog` domain — builtin `fusion-orchestrate` skill definition.
 */

import type { SkillDefinition } from '#/app/skillCatalog/types';
import { parseSkillText } from '#/app/skillCatalog/parser';
import FUSION_ORCHESTRATE_BODY from './fusion-orchestrate.md?raw';

const PSEUDO_PATH = 'builtin://fusion-orchestrate';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/fusion-orchestrate.md',
  skillDirName: 'fusion-orchestrate',
  source: 'builtin',
  text: FUSION_ORCHESTRATE_BODY,
});

export const FUSION_ORCHESTRATE_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
