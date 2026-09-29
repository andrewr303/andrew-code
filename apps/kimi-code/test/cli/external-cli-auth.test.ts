import { describe, expect, it } from 'vitest';

import { formatExternalAuthStatus, parseLoginTarget } from '#/cli/external-cli-auth';

describe('parseLoginTarget', () => {
  it('accepts perplexity', () => {
    expect(parseLoginTarget('perplexity')).toBe('perplexity');
  });

  it('keeps existing targets', () => {
    expect(parseLoginTarget(undefined)).toBe('kimi');
    expect(parseLoginTarget('claude')).toBe('claude');
    expect(parseLoginTarget('codex')).toBe('codex');
    expect(parseLoginTarget('xai')).toBe('xai');
    expect(parseLoginTarget('kimi-platform')).toBe('kimi-platform');
  });

  it('rejects unknown targets with a hint that mentions perplexity', () => {
    expect(() => parseLoginTarget('bogus')).toThrow(/perplexity/);
  });

  it('mentions perplexity login in the status text', () => {
    expect(formatExternalAuthStatus()).toContain('andrewcode login perplexity');
  });
});
