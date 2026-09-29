import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import RETRIEVE_BODY from './retrieve.md?raw';

const PSEUDO_PATH = 'builtin://retrieve';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/retrieve.md',
  skillDirName: 'retrieve',
  source: 'builtin',
  text: RETRIEVE_BODY,
});

export const RETRIEVE_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
