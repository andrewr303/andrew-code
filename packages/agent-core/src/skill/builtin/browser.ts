import { parseSkillText } from '../parser';
import type { SkillDefinition } from '../types';
import BROWSER_BODY from './browser.md?raw';

const PSEUDO_PATH = 'builtin://browser';

const parsed = parseSkillText({
  skillMdPath: '/builtin/skills/browser.md',
  skillDirName: 'browser',
  source: 'builtin',
  text: BROWSER_BODY,
});

export const BROWSER_SKILL: SkillDefinition = {
  ...parsed,
  path: PSEUDO_PATH,
  dir: PSEUDO_PATH,
  metadata: {
    ...parsed.metadata,
    type: parsed.metadata.type ?? 'inline',
  },
};
