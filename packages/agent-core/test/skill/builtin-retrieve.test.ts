import { describe, expect, it } from 'vitest';

import { RETRIEVE_SKILL, SessionSkillRegistry, registerBuiltinSkills } from '../../src/skill';

describe('builtin skill: retrieve', () => {
  it('has the expected identity and inline metadata', () => {
    expect(RETRIEVE_SKILL.name).toBe('retrieve');
    expect(RETRIEVE_SKILL.source).toBe('builtin');
    expect(RETRIEVE_SKILL.description.length).toBeGreaterThan(0);
    expect(RETRIEVE_SKILL.metadata.type).toBe('inline');
    expect(RETRIEVE_SKILL.path).toBe('builtin://retrieve');
    expect(RETRIEVE_SKILL.dir).toBe('builtin://retrieve');
  });

  it('is model-invocable (does not disable model invocation)', () => {
    expect(RETRIEVE_SKILL.metadata.disableModelInvocation).not.toBe(true);
  });

  it('contains the validated retrieval commands and routing policy', () => {
    const content = RETRIEVE_SKILL.content;
    expect(content).toContain('probe search');
    expect(content).toContain('probe symbols');
    expect(content).toContain('probe extract');
    expect(content).toContain('probe query');
    expect(content).toContain('ast-grep run');
    expect(content).toContain('ast-grep outline');
    expect(content).toContain('rg');
  });

  it('registers through registerBuiltinSkills and shows up as model-invocable', () => {
    const registry = new SessionSkillRegistry();
    registerBuiltinSkills(registry);

    expect(registry.getSkill('retrieve')).toBeDefined();
    expect(registry.listInvocableSkills().some((skill) => skill.name === 'retrieve')).toBe(true);
  });
});
