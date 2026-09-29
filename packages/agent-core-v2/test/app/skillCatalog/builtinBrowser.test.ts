/**
 * Scenario: the builtin `browser` skill identity and visibility.
 *
 * Asserts the Chrome-control skill ships as a neutral builtin (not gated by
 * the `builtin_product_skills` switch) so it stays available on every
 * surface. Run with `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run
 * test/app/skillCatalog/builtinBrowser.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { BROWSER_SKILL, BUILTIN_SKILLS, visibleBuiltinSkills } from '#/app/skillCatalog/builtin/builtin';

describe('builtin skill: browser', () => {
  it('has the expected identity and inline metadata', () => {
    expect(BROWSER_SKILL.name).toBe('browser');
    expect(BROWSER_SKILL.source).toBe('builtin');
    expect(BROWSER_SKILL.description.length).toBeGreaterThan(0);
    expect(BROWSER_SKILL.description.toLowerCase()).toContain('chrome');
  });

  it('is neutral (not gated by the product-skills switch)', () => {
    expect(BROWSER_SKILL.productSpecific).not.toBe(true);
    expect(BUILTIN_SKILLS.map((s) => s.name)).toContain('browser');
  });

  it('pins the bsk session lifecycle and help authority', () => {
    expect(BROWSER_SKILL.content).toContain('bsk session start');
    expect(BROWSER_SKILL.content).toContain('--session <id>');
    expect(BROWSER_SKILL.content).toContain('bsk session stop');
    expect(BROWSER_SKILL.content).toContain('bsk --help');
  });

  it('pins the safety rules', () => {
    expect(BROWSER_SKILL.content.toLowerCase()).toContain('untrusted');
    expect(BROWSER_SKILL.content).toContain('request-help');
  });

  it('stays visible when product skills are disabled', () => {
    expect(visibleBuiltinSkills(false).map((s) => s.name)).toContain('browser');
    expect(visibleBuiltinSkills(true).map((s) => s.name)).toContain('browser');
  });
});
