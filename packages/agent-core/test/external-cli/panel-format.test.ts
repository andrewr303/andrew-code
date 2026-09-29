import { describe, expect, it } from 'vitest';

import { formatFusionPanelReport } from '../../src/external-cli';

describe('formatFusionPanelReport', () => {
  it('labels absent panelists without inventing output', () => {
    const report = formatFusionPanelReport({
      mode: 'panel',
      host: 'andrewcode',
      returned: 1,
      absent: 1,
      ms: 12,
      panel: [
        {
          provider: 'codex',
          status: 'returned',
          output: 'hello from codex',
          ms: 10,
        },
        {
          provider: 'claude',
          status: 'absent',
          output: '',
          ms: 0,
          error: 'CLI not available on PATH',
        },
      ],
    });
    expect(report).toContain('mode=panel');
    expect(report).toContain('hello from codex');
    expect(report).toContain('claude · absent');
    expect(report).toContain('Absent ≠ agreement');
  });

  it('detect mode lists login helpers', () => {
    const report = formatFusionPanelReport({
      mode: 'detect',
      host: 'andrewcode',
      panel: [],
      returned: 0,
      absent: 0,
      ms: 0,
    });
    expect(report).toContain('Provider availability');
    expect(report).toContain('login claude');
    expect(report).toContain('login --codex');
  });
});
