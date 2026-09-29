import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fusionScriptCommand,
  fusionScriptFileName,
  openFusionDashboard,
  resolveFusionScriptsRoot,
} from '#/tui/utils/fusion-scripts';

// The packaged `<appRoot>/fusion-plugin/scripts` candidate depends on where
// the repo is checked out and whether the packaging step has run; make it
// deterministically absent so these tests control the resolution order.
vi.mock('#/cli/version', () => ({
  getHostPackageRoot: () => {
    throw new Error('packaged dir not available in tests');
  },
}));

const FUSION_SH = '#!/usr/bin/env bash\n';

const originalEnv: Record<string, string | undefined> = {
  FUSION_PLUGIN_ROOT: process.env['FUSION_PLUGIN_ROOT'],
  HOME: process.env['HOME'],
  USERPROFILE: process.env['USERPROFILE'],
};
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-scripts-test-'));
  tempDirs.push(dir);
  return dir;
}

/** Point os.homedir() at a disposable directory and reset the plugin env. */
function isolateHome(): string {
  const home = makeTempDir();
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;
  delete process.env['FUSION_PLUGIN_ROOT'];
  return home;
}

function makeScriptsDir(parent: string): string {
  const scripts = join(parent, 'scripts');
  mkdirSync(scripts, { recursive: true });
  writeFileSync(join(scripts, 'fusion.sh'), FUSION_SH, 'utf8');
  return scripts;
}

afterEach(() => {
  for (const key of ['FUSION_PLUGIN_ROOT', 'HOME', 'USERPROFILE'] as const) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveFusionScriptsRoot', () => {
  it('uses FUSION_PLUGIN_ROOT as-is when it already names a scripts dir', () => {
    isolateHome();
    const scripts = makeScriptsDir(makeTempDir());
    process.env['FUSION_PLUGIN_ROOT'] = scripts;

    expect(resolveFusionScriptsRoot()).toBe(scripts);
  });

  it('appends scripts to FUSION_PLUGIN_ROOT when it names the plugin root', () => {
    isolateHome();
    const pluginRoot = makeTempDir();
    const scripts = makeScriptsDir(pluginRoot);
    process.env['FUSION_PLUGIN_ROOT'] = pluginRoot;

    expect(resolveFusionScriptsRoot()).toBe(scripts);
  });

  it('falls through to the home dirs when the env root lacks fusion.sh', () => {
    const home = isolateHome();
    const homeScripts = join(home, '.andrewcode', 'plugins', 'managed', 'fusion', 'scripts');
    mkdirSync(homeScripts, { recursive: true });
    writeFileSync(join(homeScripts, 'fusion.sh'), FUSION_SH, 'utf8');
    process.env['FUSION_PLUGIN_ROOT'] = makeTempDir(); // present but empty

    expect(resolveFusionScriptsRoot()).toBe(homeScripts);
  });

  it('prefers .andrewcode over .claude under the home directory', () => {
    const home = isolateHome();
    const andrewcodeScripts = join(home, '.andrewcode', 'plugins', 'managed', 'fusion', 'scripts');
    const claudeScripts = join(home, '.claude', 'plugins', 'fusion', 'scripts');
    for (const dir of [andrewcodeScripts, claudeScripts]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'fusion.sh'), FUSION_SH, 'utf8');
    }

    expect(resolveFusionScriptsRoot()).toBe(andrewcodeScripts);
  });

  it('falls back to the .claude home dir', () => {
    const home = isolateHome();
    const claudeScripts = join(home, '.claude', 'plugins', 'fusion', 'scripts');
    mkdirSync(claudeScripts, { recursive: true });
    writeFileSync(join(claudeScripts, 'fusion.sh'), FUSION_SH, 'utf8');

    expect(resolveFusionScriptsRoot()).toBe(claudeScripts);
  });

  it('returns undefined when no candidate holds fusion.sh', () => {
    isolateHome();

    expect(resolveFusionScriptsRoot()).toBeUndefined();
  });
});

describe('fusionScriptFileName', () => {
  it('maps board, context, and ultraswarm onto their plugin scripts', () => {
    expect(fusionScriptFileName('ultraswarm')).toBe('ultraswarm.sh');
    expect(fusionScriptFileName('board')).toBe('board.sh');
    expect(fusionScriptFileName('context')).toBe('context.sh');
  });

  it('keeps existing form script names', () => {
    expect(fusionScriptFileName('hive')).toBe('swarm.sh');
    expect(fusionScriptFileName('graph')).toBe('swarm.sh');
    expect(fusionScriptFileName('designer')).toBe('swarm.sh');
    expect(fusionScriptFileName('metaloop')).toBe('swarm.sh');
    expect(fusionScriptFileName('ultracode')).toBe('ultracode.sh');
    expect(fusionScriptFileName('detect')).toBe('fusion.sh');
  });
});

describe('fusionScriptCommand', () => {
  it('uses the prompt for ultraswarm and --discover when empty', () => {
    expect(fusionScriptCommand('ultraswarm', { prompt: 'Design the council' })).toEqual({
      script: 'ultraswarm.sh',
      args: ['--non-interactive', '--task', 'Design the council'],
    });
    expect(fusionScriptCommand('ultraswarm')).toEqual({
      script: 'ultraswarm.sh',
      args: ['--discover'],
    });
  });

  it('defaults board to agents and appends --db', () => {
    const defaultDb = fusionScriptCommand('board').args[1];
    expect(fusionScriptCommand('board')).toEqual({
      script: 'board.sh',
      args: ['--db', defaultDb, 'agents'],
    });
    expect(defaultDb).toMatch(/board\.sqlite$/);
    expect(fusionScriptCommand('board', { boardVerb: 'poll', boardDb: 'hive.sqlite' })).toEqual({
      script: 'board.sh',
      args: ['--db', 'hive.sqlite', 'poll'],
    });
  });

  it('maps context action plus key/value', () => {
    expect(fusionScriptCommand('context')).toEqual({
      script: 'context.sh',
      args: ['list'],
    });
    expect(
      fusionScriptCommand('context', {
        contextAction: 'set',
        contextKey: 'goal',
        contextValue: 'ship',
      }),
    ).toEqual({
      script: 'context.sh',
      args: ['set', 'goal', 'ship'],
    });
  });
});

describe('openFusionDashboard', () => {
  it('resolves undefined without spawning when no scripts root exists', async () => {
    isolateHome();

    await expect(openFusionDashboard(8765)).resolves.toBeUndefined();
  });
});