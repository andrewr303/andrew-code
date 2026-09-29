import { describe, expect, it } from 'vitest';

import { CodeModeRuntime, resolveEffectiveCodeMode, shouldExposeToolToModel } from '../../src/code-mode';

describe('code mode policy', () => {
  it('lets a Codex model requirement force Code Mode Only', () => {
    expect(
      resolveEffectiveCodeMode({ userPreference: 'direct', modelRequirement: 'code_mode_only' }),
    ).toBe('code_mode_only');
  });

  it('hides ordinary tools from the model in Code Mode Only', () => {
    expect(shouldExposeToolToModel('Read', 'code_mode_only')).toBe(false);
    expect(shouldExposeToolToModel('exec', 'code_mode_only')).toBe(true);
    expect(shouldExposeToolToModel('Fusion', 'code_mode_only')).toBe(true);
    expect(shouldExposeToolToModel('exec', 'direct')).toBe(false);
  });
});

describe('CodeModeRuntime', () => {
  it('runs persistent JavaScript and dispatches tools.*', async () => {
    const runtime = new CodeModeRuntime();
    const calls: string[] = [];
    runtime.attach(async (name, args) => {
      calls.push(name);
      return { name, result: { ok: true, args } };
    });
    const cell = await runtime.exec('return await tools.Read({ path: "README.md" })');
    expect(cell.status).toBe('completed');
    expect(calls).toEqual(['Read']);
    expect(cell.output).toContain('README.md');
    runtime.dispose();
  });
});
