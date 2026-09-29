/**
 * Scenario: fusion script-bridge helpers and the Fusion tool input schema.
 * Responsibilities: verify script-root resolution precedence, form→command
 * mapping, schema strictness for the script-backed modes, and the bash runner
 * against a fixture script in a temp directory.
 * Wiring: no DI services — pure helpers plus the FusionInputSchema; the bash
 * runner group skips when no bash executable resolves.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/agent/tools/fusion.test.ts`.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FusionInputSchema } from '#/agent/tools/fusion/fusion';
import {
  resolveBash,
  resolveFusionScriptsRoot,
  runFusionScript,
  scriptFormCommand,
} from '#/agent/tools/fusion/fusionScripts';

function writeTree(file: string, content = '#!/usr/bin/env bash\necho ok\n'): string {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, content);
  return file;
}

describe('resolveFusionScriptsRoot', () => {
  const SAVED = ['HOME', 'USERPROFILE', 'FUSION_PLUGIN_ROOT'].reduce<Record<string, string | undefined>>(
    (acc, key) => {
      acc[key] = process.env[key];
      return acc;
    },
    {},
  );

  let tmp: string;
  let pluginRoot: string;
  let scriptsOnly: string;
  let homeAndrew: string;
  let homeClaude: string;
  let emptyHome: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'fusion-root-'));
    pluginRoot = join(tmp, 'plugin');
    scriptsOnly = join(tmp, 'scripts');
    homeAndrew = join(tmp, 'home-a');
    homeClaude = join(tmp, 'home-c');
    emptyHome = join(tmp, 'home-empty');
    writeTree(join(pluginRoot, 'scripts', 'fusion.sh'));
    writeTree(join(scriptsOnly, 'fusion.sh'));
    writeTree(join(homeAndrew, '.andrewcode', 'plugins', 'managed', 'fusion', 'scripts', 'fusion.sh'));
    writeTree(join(homeClaude, '.claude', 'plugins', 'fusion', 'scripts', 'fusion.sh'));
    mkdirSync(emptyHome, { recursive: true });
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(SAVED)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  beforeEach(() => {
    delete process.env['FUSION_PLUGIN_ROOT'];
    delete process.env['HOME'];
    delete process.env['USERPROFILE'];
  });

  it('uses FUSION_PLUGIN_ROOT when it points at the plugin root', () => {
    process.env['FUSION_PLUGIN_ROOT'] = pluginRoot;
    process.env['HOME'] = homeClaude;
    process.env['USERPROFILE'] = homeClaude;
    expect(resolveFusionScriptsRoot()).toBe(join(pluginRoot, 'scripts'));
  });

  it('accepts FUSION_PLUGIN_ROOT pointing directly at a scripts dir', () => {
    process.env['FUSION_PLUGIN_ROOT'] = scriptsOnly;
    expect(resolveFusionScriptsRoot()).toBe(scriptsOnly);
  });

  it('ignores an invalid FUSION_PLUGIN_ROOT and uses the configured root', () => {
    process.env['FUSION_PLUGIN_ROOT'] = join(tmp, 'nope');
    expect(resolveFusionScriptsRoot(pluginRoot)).toBe(join(pluginRoot, 'scripts'));
  });

  it('prefers FUSION_PLUGIN_ROOT over the configured root', () => {
    process.env['FUSION_PLUGIN_ROOT'] = scriptsOnly;
    expect(resolveFusionScriptsRoot(pluginRoot)).toBe(scriptsOnly);
  });

  it('falls back to the andrewcode plugin scripts under HOME', () => {
    process.env['HOME'] = homeAndrew;
    process.env['USERPROFILE'] = homeAndrew;
    expect(resolveFusionScriptsRoot()).toBe(join(homeAndrew, '.andrewcode', 'plugins', 'managed', 'fusion', 'scripts'));
  });

  it('falls back to the claude plugin scripts under HOME', () => {
    process.env['HOME'] = homeClaude;
    process.env['USERPROFILE'] = homeClaude;
    expect(resolveFusionScriptsRoot()).toBe(join(homeClaude, '.claude', 'plugins', 'fusion', 'scripts'));
  });

  it('prefers the configured root over the HOME candidates', () => {
    process.env['HOME'] = homeClaude;
    process.env['USERPROFILE'] = homeClaude;
    expect(resolveFusionScriptsRoot(pluginRoot)).toBe(join(pluginRoot, 'scripts'));
  });

  it('returns undefined when nothing matches', () => {
    process.env['HOME'] = emptyHome;
    process.env['USERPROFILE'] = emptyHome;
    expect(resolveFusionScriptsRoot()).toBeUndefined();
  });
});

describe('scriptFormCommand', () => {
  it('maps hive with captains, children, and dry-run', () => {
    expect(scriptFormCommand('hive', { prompt: 'build it' })).toEqual({
      script: 'swarm.sh',
      args: ['hive', 'build it', '--children', '4'],
    });
    expect(
      scriptFormCommand('hive', {
        prompt: 'task',
        captains: ['codex', 'grok'],
        childrenPerCaptain: 2,
        dryRun: true,
      }),
    ).toEqual({
      script: 'swarm.sh',
      args: ['hive', 'task', '--captains', 'codex,grok', '--children', '2', '--dry-run'],
    });
  });

  it('maps graph with --spec, --plan for dry runs, --json otherwise', () => {
    expect(scriptFormCommand('graph', { prompt: 'task', spec: 'graph.json', dryRun: true })).toEqual({
      script: 'swarm.sh',
      args: ['graph', 'task', '--spec', 'graph.json', '--plan'],
    });
    expect(scriptFormCommand('graph', { prompt: 'task' })).toEqual({
      script: 'swarm.sh',
      args: ['graph', 'task', '--json'],
    });
  });

  it('maps designer', () => {
    expect(scriptFormCommand('designer', { prompt: 'design me' })).toEqual({
      script: 'swarm.sh',
      args: ['designer', 'design me'],
    });
  });

  it('maps metaloop with an optional plan file', () => {
    expect(scriptFormCommand('metaloop', { prompt: 'task' })).toEqual({
      script: 'swarm.sh',
      args: ['metaloop', 'task'],
    });
    expect(scriptFormCommand('metaloop', { prompt: 'task', planFile: 'plan.json' })).toEqual({
      script: 'swarm.sh',
      args: ['metaloop', 'task', '--plan-file', 'plan.json'],
    });
  });

  it('maps ultracode with a default doctor verb', () => {
    expect(scriptFormCommand('ultracode', { prompt: '' })).toEqual({
      script: 'ultracode.sh',
      args: ['doctor'],
    });
    expect(scriptFormCommand('ultracode', { prompt: '', verb: 'status' })).toEqual({
      script: 'ultracode.sh',
      args: ['status'],
    });
  });

  it('maps detect', () => {
    expect(scriptFormCommand('detect', { prompt: '' })).toEqual({
      script: 'fusion.sh',
      args: ['detect', '--json'],
    });
  });

  it('maps ultraswarm to ultraswarm.sh with the prompt, or --discover when empty', () => {
    expect(scriptFormCommand('ultraswarm', { prompt: 'five-agent council' })).toEqual({
      script: 'ultraswarm.sh',
      args: ['--non-interactive', '--task', 'five-agent council'],
    });
    expect(scriptFormCommand('ultraswarm', { prompt: '' })).toEqual({
      script: 'ultraswarm.sh',
      args: ['--discover'],
    });
    expect(scriptFormCommand('ultraswarm', { prompt: '   ' })).toEqual({
      script: 'ultraswarm.sh',
      args: ['--discover'],
    });
  });

  it('maps board to board.sh with default agents verb, optional db, and extras', () => {
    const defaultDb = scriptFormCommand('board', { prompt: '' }).args[1];
    expect(scriptFormCommand('board', { prompt: '' })).toEqual({
      script: 'board.sh',
      args: ['--db', defaultDb, 'agents'],
    });
    expect(defaultDb).toMatch(/board\.sqlite$/);
    expect(
      scriptFormCommand('board', {
        prompt: '--agent arch',
        boardVerb: 'poll',
        boardDb: 'hive.sqlite',
      }),
    ).toEqual({
      script: 'board.sh',
      args: ['--db', 'hive.sqlite', 'poll', '--agent', 'arch'],
    });
    expect(scriptFormCommand('board', { prompt: '', boardVerb: 'channels' })).toEqual({
      script: 'board.sh',
      args: ['--db', defaultDb, 'channels'],
    });
  });

  it('maps context to context.sh with action plus key/value', () => {
    expect(scriptFormCommand('context', { prompt: '' })).toEqual({
      script: 'context.sh',
      args: ['list'],
    });
    expect(
      scriptFormCommand('context', {
        prompt: '',
        contextAction: 'get',
        contextKey: 'phase',
      }),
    ).toEqual({
      script: 'context.sh',
      args: ['get', 'phase'],
    });
    expect(
      scriptFormCommand('context', {
        prompt: 'collect',
        contextAction: 'set',
        contextKey: 'phase',
        contextValue: 'collect',
      }),
    ).toEqual({
      script: 'context.sh',
      args: ['set', 'phase', 'collect'],
    });
    expect(
      scriptFormCommand('context', {
        prompt: 'from-prompt',
        contextAction: 'set',
        contextKey: 'phase',
      }),
    ).toEqual({
      script: 'context.sh',
      args: ['set', 'phase', 'from-prompt'],
    });
    expect(
      scriptFormCommand('context', {
        prompt: '',
        contextAction: 'clear',
        contextKey: 'phase',
      }),
    ).toEqual({
      script: 'context.sh',
      args: ['clear', 'phase'],
    });
    expect(scriptFormCommand('context', { prompt: '', contextAction: 'snapshot' })).toEqual({
      script: 'context.sh',
      args: ['snapshot'],
    });
  });
});

describe('FusionInputSchema', () => {
  it('accepts the new script modes and parameters', () => {
    expect(
      FusionInputSchema.safeParse({
        mode: 'hive',
        prompt: 'task',
        captains: ['codex', 'opencode'],
        children_per_captain: 3,
        dry_run: true,
      }).success,
    ).toBe(true);
    expect(FusionInputSchema.safeParse({ mode: 'ultracode', verb: 'doctor' }).success).toBe(true);
    expect(FusionInputSchema.safeParse({ mode: 'graph', prompt: 'task', spec: 'graph.json', dry_run: true }).success).toBe(true);
    expect(FusionInputSchema.safeParse({ mode: 'metaloop', prompt: 'task', plan_file: 'plan.json' }).success).toBe(true);
    expect(FusionInputSchema.safeParse({ mode: 'designer', prompt: 'task' }).success).toBe(true);
    expect(FusionInputSchema.safeParse({ mode: 'panel', prompt: 'task', layers: 3 }).success).toBe(true);
    expect(FusionInputSchema.safeParse({ mode: 'ultraswarm', prompt: 'council' }).success).toBe(true);
    expect(FusionInputSchema.safeParse({ mode: 'ultraswarm' }).success).toBe(true);
    expect(
      FusionInputSchema.safeParse({
        mode: 'board',
        board_verb: 'poll',
        board_db: 'hive.sqlite',
        thinking_effort: 'xhigh',
      }).success,
    ).toBe(true);
    expect(
      FusionInputSchema.safeParse({
        mode: 'context',
        context_action: 'set',
        context_key: 'phase',
        context_value: 'collect',
      }).success,
    ).toBe(true);
  });

  it('rejects unknown modes', () => {
    expect(FusionInputSchema.safeParse({ mode: 'unknown-mode', prompt: 'task' }).success).toBe(false);
    expect(FusionInputSchema.safeParse({ mode: 'agency-context' }).success).toBe(false);
  });

  it('rejects unknown keys (strict)', () => {
    expect(FusionInputSchema.safeParse({ mode: 'panel', prompt: 'task', bogus: 1 }).success).toBe(false);
    expect(FusionInputSchema.safeParse({ mode: 'hive', prompt: 'task', captains: [], dry_runs: true }).success).toBe(false);
  });

  it('rejects out-of-range values', () => {
    expect(FusionInputSchema.safeParse({ children_per_captain: 0 }).success).toBe(false);
    expect(FusionInputSchema.safeParse({ children_per_captain: 9 }).success).toBe(false);
    expect(FusionInputSchema.safeParse({ layers: 5 }).success).toBe(false);
    expect(FusionInputSchema.safeParse({ verb: 'wat' }).success).toBe(false);
    expect(FusionInputSchema.safeParse({ board_verb: 'post' }).success).toBe(false);
    expect(FusionInputSchema.safeParse({ context_action: 'delete' }).success).toBe(false);
    expect(
      FusionInputSchema.safeParse({
        captains: ['codex', 'claude', 'copilot', 'opencode', 'grok', 'kimi', 'andrewcode', 'codex', 'codex'],
      }).success,
    ).toBe(false);
  });
});

const BASH = resolveBash();

describe.skipIf(BASH === undefined)('runFusionScript', () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fusion-script-run-'));
    writeFileSync(
      join(dir, 'fixture.sh'),
      [
        '#!/usr/bin/env bash',
        'echo "out:$1:$2"',
        'echo "err-line" >&2',
        'echo "env:${FIXTURE_ENV:-unset}"',
        'echo cwd-ok > "$(pwd)/cwd-marker.txt"',
        'exit "${FIXTURE_EXIT:-0}"',
        '',
      ].join('\n'),
    );
    writeFileSync(join(dir, 'sleeper.sh'), ['#!/usr/bin/env bash', 'while :; do :; done', ''].join('\n'));
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs a script through bash and captures stdout, stderr, and exit code', async () => {
    const result = await runFusionScript({
      script: join(dir, 'fixture.sh'),
      args: ['a', 'b'],
      cwd: dir,
      timeoutMs: 30_000,
      env: { FIXTURE_ENV: 'x' },
    });
    expect(result.error).toBeUndefined();
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('out:a:b');
    expect(result.stdout).toContain('env:x');
    expect(result.stderr).toContain('err-line');
    expect(existsSync(join(dir, 'cwd-marker.txt'))).toBe(true);
  });

  it('reports a nonzero exit code', async () => {
    const result = await runFusionScript({
      script: join(dir, 'fixture.sh'),
      args: [],
      cwd: dir,
      timeoutMs: 30_000,
      env: { FIXTURE_EXIT: '3' },
    });
    expect(result.error).toBeUndefined();
    expect(result.exitCode).toBe(3);
  });

  it('surfaces a missing script as a nonzero exit', async () => {
    const result = await runFusionScript({
      script: join(dir, 'nope.sh'),
      args: [],
      cwd: dir,
      timeoutMs: 30_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('nope.sh');
  });

  it('times out a runaway script', async () => {
    const result = await runFusionScript({
      script: join(dir, 'sleeper.sh'),
      args: [],
      cwd: dir,
      timeoutMs: 500,
    });
    expect(result.timedOut).toBe(true);
  });
});