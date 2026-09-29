import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { RunnableToolExecution } from '../../src/loop/types';
import {
  FusionTool,
  FusionToolInputSchema,
} from '../../src/tools/builtin/collaboration/fusion';

describe('FusionToolInputSchema', () => {
  it('accepts new script-backed swarm modes', () => {
    const modes = [
      'graph',
      'hive',
      'designer',
      'metaloop',
      'ultracode',
      'ultraswarm',
      'board',
      'context',
    ] as const;
    for (const mode of modes) {
      const parsed = FusionToolInputSchema.parse({ mode, prompt: 'test task' });
      expect(parsed.mode).toBe(mode);
    }
  });

  it('rejects unknown modes', () => {
    expect(FusionToolInputSchema.safeParse({ mode: 'wat', prompt: 'task' }).success).toBe(false);
  });

  it('accepts new optional parameters with valid constraints', () => {
    const parsed = FusionToolInputSchema.parse({
      mode: 'hive',
      prompt: 'task',
      captains: ['codex', 'copilot'],
      children_per_captain: 4,
      layers: 2,
      dry_run: true,
      verb: 'doctor',
      plan_file: 'spec.json',
    });
    expect(parsed.captains).toEqual(['codex', 'copilot']);
    expect(parsed.children_per_captain).toBe(4);
    expect(parsed.layers).toBe(2);
    expect(parsed.dry_run).toBe(true);
    expect(parsed.verb).toBe('doctor');
    expect(parsed.plan_file).toBe('spec.json');
  });

  it('accepts board, context, ultraswarm, and thinking_effort fields', () => {
    const board = FusionToolInputSchema.parse({
      mode: 'board',
      board_verb: 'poll',
      board_db: 'hive.sqlite',
      thinking_effort: 'high',
    });
    expect(board.board_verb).toBe('poll');
    expect(board.board_db).toBe('hive.sqlite');
    expect(board.thinking_effort).toBe('high');

    const ctx = FusionToolInputSchema.parse({
      mode: 'context',
      context_action: 'set',
      context_key: 'phase',
      context_value: 'collect',
    });
    expect(ctx.context_action).toBe('set');
    expect(ctx.context_key).toBe('phase');
    expect(ctx.context_value).toBe('collect');

    expect(FusionToolInputSchema.parse({ mode: 'ultraswarm' }).mode).toBe('ultraswarm');
  });

  it('rejects invalid board_verb and context_action', () => {
    expect(
      FusionToolInputSchema.safeParse({
        mode: 'board',
        board_verb: 'destroy',
      }).success,
    ).toBe(false);
    expect(
      FusionToolInputSchema.safeParse({
        mode: 'context',
        context_action: 'drop',
      }).success,
    ).toBe(false);
  });

  it('rejects invalid verb', () => {
    expect(() =>
      FusionToolInputSchema.parse({
        mode: 'ultracode',
        verb: 'destroy' as any,
      }),
    ).toThrow();
  });

  it('rejects children_per_captain outside 1..8 range', () => {
    expect(() =>
      FusionToolInputSchema.parse({
        mode: 'hive',
        prompt: 'task',
        children_per_captain: 0,
      }),
    ).toThrow();

    expect(() =>
      FusionToolInputSchema.parse({
        mode: 'hive',
        prompt: 'task',
        children_per_captain: 9,
      }),
    ).toThrow();
  });

  it('rejects layers outside 1..4 range', () => {
    expect(() =>
      FusionToolInputSchema.parse({
        mode: 'graph',
        prompt: 'task',
        layers: 5,
      }),
    ).toThrow();
  });

  it('rejects unknown fields due to strict schema', () => {
    expect(() =>
      FusionToolInputSchema.parse({
        mode: 'hive',
        prompt: 'task',
        unknownProperty: 'bad',
      }),
    ).toThrow();
  });
});

describe('FusionTool execution', () => {
  const tool = new FusionTool();
  const mockContext = {
    signal: new AbortController().signal,
  } as any;

  it('resolves execution description and summary for new modes', () => {
    const execHive = tool.resolveExecution({ mode: 'hive', prompt: 'test' }) as RunnableToolExecution;
    expect(execHive.description).toBe('Fusion hive dispatch');
    expect((execHive.display as any)?.summary).toBe('Fusion hive');

    const execGraph = tool.resolveExecution({ mode: 'graph', prompt: 'test' }) as RunnableToolExecution;
    expect(execGraph.description).toBe('Fusion graph dispatch');
    expect((execGraph.display as any)?.summary).toBe('Fusion graph');

    const execBoard = tool.resolveExecution({ mode: 'board' }) as RunnableToolExecution;
    expect(execBoard.description).toBe('Fusion board dispatch');
    expect((execBoard.display as any)?.summary).toBe('Fusion board');
  });

  it('returns clear error naming FUSION_PLUGIN_ROOT / plugin install when scripts unavailable', async () => {
    const prevEnv = process.env['FUSION_PLUGIN_ROOT'];
    const prevScripts = process.env['FUSION_SCRIPTS_ROOT'];
    process.env['FUSION_PLUGIN_ROOT'] = '/nonexistent/path/for/fusion';
    delete process.env['FUSION_SCRIPTS_ROOT'];

    try {
      const exec = tool.resolveExecution({ mode: 'hive', prompt: 'test task' }) as RunnableToolExecution;
      const result = await exec.execute(mockContext);
      const out = String(result.output);
      if (result.isError && out.includes('Fusion error: scripts bundle not found')) {
        expect(out).toContain('FUSION_PLUGIN_ROOT');
        expect(out).toContain('install the fusion plugin');
      }
    } finally {
      if (prevEnv !== undefined) process.env['FUSION_PLUGIN_ROOT'] = prevEnv;
      else delete process.env['FUSION_PLUGIN_ROOT'];
      if (prevScripts !== undefined) process.env['FUSION_SCRIPTS_ROOT'] = prevScripts;
    }
  });

  it('requires prompt for hive, graph, metaloop modes', async () => {
    const execHive = tool.resolveExecution({ mode: 'hive', prompt: '   ' }) as RunnableToolExecution;
    const result = await execHive.execute(mockContext);
    expect(result.isError).toBe(true);
    expect(String(result.output)).toContain('`prompt` is required for mode hive');
  });

  it('preserves existing detect mode behavior without requiring prompt', async () => {
    const execDetect = tool.resolveExecution({ mode: 'detect' }) as RunnableToolExecution;
    const result = await execDetect.execute(mockContext);
    expect(result.isError).toBeUndefined();
    expect(String(result.output)).toContain('mode=detect');
  });

  it('does not require prompt for ultraswarm, board, or context', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fusion-test-noprompt-'));
    const prevEnv = process.env['FUSION_PLUGIN_ROOT'];
    const prevScripts = process.env['FUSION_SCRIPTS_ROOT'];
    process.env['FUSION_PLUGIN_ROOT'] = tmp;
    delete process.env['FUSION_SCRIPTS_ROOT'];

    try {
      for (const mode of ['ultraswarm', 'board', 'context'] as const) {
        const exec = tool.resolveExecution({ mode }) as RunnableToolExecution;
        const result = await exec.execute(mockContext);
        expect(String(result.output)).not.toContain('`prompt` is required');
      }
    } finally {
      if (prevEnv !== undefined) process.env['FUSION_PLUGIN_ROOT'] = prevEnv;
      else delete process.env['FUSION_PLUGIN_ROOT'];
      if (prevScripts !== undefined) process.env['FUSION_SCRIPTS_ROOT'] = prevScripts;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
