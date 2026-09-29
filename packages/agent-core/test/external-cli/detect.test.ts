import { describe, expect, it } from 'vitest';

import { detectExternalClis, listAvailablePanelists } from '../../src/external-cli';

describe('external-cli detect', () => {
  it('returns a probe map for every known panelist', () => {
    const result = detectExternalClis();
    expect(result.providers.claude).toBeDefined();
    expect(result.providers.codex).toBeDefined();
    expect(result.providers.copilot).toBeDefined();
    expect(result.providers.opencode).toBeDefined();
    expect(result.providers.grok).toBeDefined();
    expect(result.providers.kimi).toBeDefined();
    expect(result.providers.andrewcode).toBeDefined();
    expect(['available', 'missing', 'degraded', 'host-native']).toContain(
      result.providers.claude.status,
    );
    expect(typeof result.livePanelists).toBe('number');
    expect(typeof result.multiModel).toBe('boolean');
  });

  it('treats FUSION_HOST as host-native', () => {
    const prev = process.env['FUSION_HOST'];
    process.env['FUSION_HOST'] = 'codex';
    try {
      const result = detectExternalClis();
      expect(result.host).toBe('codex');
      expect(result.providers.codex.status).toBe('host-native');
    } finally {
      if (prev === undefined) delete process.env['FUSION_HOST'];
      else process.env['FUSION_HOST'] = prev;
    }
  });

  it('listAvailablePanelists excludes host-native and missing', () => {
    const detect = detectExternalClis();
    const list = listAvailablePanelists(detect);
    for (const id of list) {
      expect(detect.providers[id].status).toBe('available');
    }
  });
});
