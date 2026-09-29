import { describe, expect, it } from 'vitest';

import { BROWSER_SKILL, SessionSkillRegistry, registerBuiltinSkills } from '../../src/skill';

describe('builtin skill: browser', () => {
  it('has the expected identity and inline metadata', () => {
    expect(BROWSER_SKILL.name).toBe('browser');
    expect(BROWSER_SKILL.source).toBe('builtin');
    expect(BROWSER_SKILL.description.length).toBeGreaterThan(0);
    expect(BROWSER_SKILL.description.toLowerCase()).toContain('chrome');
    expect(BROWSER_SKILL.metadata.type).toBe('inline');
  });

  it('is model-invocable (does not disable model invocation)', () => {
    expect(BROWSER_SKILL.metadata.disableModelInvocation).not.toBe(true);
  });

  it('pins the bsk session lifecycle and help authority', () => {
    const content = BROWSER_SKILL.content;
    expect(content).toContain('bsk session start');
    expect(content).toContain('--session <id>');
    expect(content).toContain('bsk session stop');
    expect(content).toContain('bsk --help');
  });

  it('pins the safety rules', () => {
    const content = BROWSER_SKILL.content;
    expect(content.toLowerCase()).toContain('untrusted');
    expect(content).toContain('request-help');
    expect(content.toLowerCase()).toContain('credentials');
  });

  it('registers through registerBuiltinSkills and shows up as model-invocable', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    expect(registry.getSkill('browser')).toBeDefined();
    expect(registry.listInvocableSkills().some((skill) => skill.name === 'browser')).toBe(true);
  });
});
