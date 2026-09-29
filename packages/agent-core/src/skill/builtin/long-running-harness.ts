import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import LONG_RUNNING_HARNESS_BODY from './long-running-harness.md?raw';

const PSEUDO_PATH = 'builtin://long-running-harness';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/long-running-harness.md',
  skillDirName: 'long-running-harness',
  source: 'builtin',
  text: LONG_RUNNING_HARNESS_BODY,
});

export const LONG_RUNNING_HARNESS_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
