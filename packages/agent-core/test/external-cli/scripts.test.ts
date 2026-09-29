import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  detectExternalClis,
  isScriptMode,
  resolveFusionScriptsRoot,
  scriptFormCommand,
} from '../../src/external-cli';

describe('isScriptMode', () => {
  it('identifies script modes correctly', () => {
    expect(isScriptMode('graph')).toBe(true);
    expect(isScriptMode('hive')).toBe(true);
    expect(isScriptMode('designer')).toBe(true);
    expect(isScriptMode('metaloop')).toBe(true);
    expect(isScriptMode('ultracode')).toBe(true);
    expect(isScriptMode('ultraswarm')).toBe(true);
    expect(isScriptMode('board')).toBe(true);
    expect(isScriptMode('context')).toBe(true);

    expect(isScriptMode('detect')).toBe(false);
    expect(isScriptMode('solo')).toBe(false);
    expect(isScriptMode('panel')).toBe(false);
    expect(isScriptMode('council')).toBe(false);
    expect(isScriptMode('debate')).toBe(false);
    expect(isScriptMode('vote')).toBe(false);
    expect(isScriptMode('swarm')).toBe(false);
  });
});

describe('scriptFormCommand mapping', () => {
  it('maps hive mode with prompt, captains, children, dry_run', () => {
    const cmd = scriptFormCommand({
      mode: 'hive',
      prompt: 'build landing page',
      captains: ['codex', 'copilot'],
      children_per_captain: 3,
      dry_run: true,
    });
    expect(cmd.script).toBe('swarm.sh');
    expect(cmd.args).toEqual([
      'hive',
      'build landing page',
      '--captains',
      'codex,copilot',
      '--children',
      '3',
      '--dry-run',
    ]);
  });

  it('maps hive mode falling back to providers when captains omitted', () => {
    const cmd = scriptFormCommand({
      mode: 'hive',
      prompt: 'task',
      providers: ['claude', 'grok'],
    });
    expect(cmd.script).toBe('swarm.sh');
    expect(cmd.args).toEqual(['hive', 'task', '--captains', 'claude,grok']);
  });

  it('maps graph mode without dry_run (--json)', () => {
    const cmd = scriptFormCommand({
      mode: 'graph',
      prompt: 'solve dag',
      dry_run: false,
    });
    expect(cmd.script).toBe('swarm.sh');
    expect(cmd.args).toEqual(['graph', 'solve dag', '--json']);
  });

  it('maps graph mode with dry_run (--plan)', () => {
    const cmd = scriptFormCommand({
      mode: 'graph',
      prompt: 'solve dag',
      dry_run: true,
    });
    expect(cmd.script).toBe('swarm.sh');
    expect(cmd.args).toEqual(['graph', 'solve dag', '--plan']);
  });

  it('maps designer mode with and without task', () => {
    const cmdWithTask = scriptFormCommand({
      mode: 'designer',
      prompt: 'nested hive topology',
    });
    expect(cmdWithTask.script).toBe('swarm.sh');
    expect(cmdWithTask.args).toEqual(['designer', 'nested hive topology']);

    const cmdNoTask = scriptFormCommand({
      mode: 'designer',
    });
    expect(cmdNoTask.script).toBe('swarm.sh');
    expect(cmdNoTask.args).toEqual(['designer']);
  });

  it('maps metaloop mode with and without plan_file', () => {
    const cmdWithPlan = scriptFormCommand({
      mode: 'metaloop',
      prompt: 'run meta loop',
      plan_file: 'spec/plan.json',
    });
    expect(cmdWithPlan.script).toBe('swarm.sh');
    expect(cmdWithPlan.args).toEqual([
      'metaloop',
      'run meta loop',
      '--plan-file',
      'spec/plan.json',
    ]);

    const cmdNoPlan = scriptFormCommand({
      mode: 'metaloop',
      prompt: 'run meta loop',
    });
    expect(cmdNoPlan.script).toBe('swarm.sh');
    expect(cmdNoPlan.args).toEqual(['metaloop', 'run meta loop']);
  });

  it('maps ultracode mode with verbs and default verb (no prompt)', () => {
    const cmdDoctor = scriptFormCommand({
      mode: 'ultracode',
      verb: 'doctor',
    });
    expect(cmdDoctor.script).toBe('ultracode.sh');
    expect(cmdDoctor.args).toEqual(['doctor']);

    const cmdTest = scriptFormCommand({
      mode: 'ultracode',
      verb: 'test',
    });
    expect(cmdTest.script).toBe('ultracode.sh');
    expect(cmdTest.args).toEqual(['test']);

    const cmdDefault = scriptFormCommand({
      mode: 'ultracode',
    });
    expect(cmdDefault.script).toBe('ultracode.sh');
    expect(cmdDefault.args).toEqual(['doctor']);
  });

  it('maps detect mode to fusion.sh detect --json', () => {
    const cmd = scriptFormCommand({
      mode: 'detect',
    });
    expect(cmd.script).toBe('fusion.sh');
    expect(cmd.args).toEqual(['detect', '--json']);
  });

  it('maps ultraswarm with a prompt as the script arg', () => {
    const cmd = scriptFormCommand({
      mode: 'ultraswarm',
      prompt: 'five-agent council',
    });
    expect(cmd.script).toBe('ultraswarm.sh');
    expect(cmd.args).toEqual(['--non-interactive', '--task', 'five-agent council']);
  });

  it('maps ultraswarm without a prompt to --discover', () => {
    expect(scriptFormCommand({ mode: 'ultraswarm' })).toEqual({
      script: 'ultraswarm.sh',
      args: ['--discover'],
    });
    expect(scriptFormCommand({ mode: 'ultraswarm', prompt: '   ' })).toEqual({
      script: 'ultraswarm.sh',
      args: ['--discover'],
    });
  });

  it('maps board with default verb agents and optional db', () => {
    const defaultDb = scriptFormCommand({ mode: 'board' }).args[1];
    expect(scriptFormCommand({ mode: 'board' })).toEqual({
      script: 'board.sh',
      args: ['--db', defaultDb, 'agents'],
    });
    expect(defaultDb).toMatch(/board\.sqlite$/);
    expect(
      scriptFormCommand({
        mode: 'board',
        board_verb: 'channels',
        board_db: '/tmp/hive.sqlite',
      }),
    ).toEqual({
      script: 'board.sh',
      args: ['--db', '/tmp/hive.sqlite', 'channels'],
    });
  });

  it('maps board poll/mentions with --agent from prompt', () => {
    const defaultDb = scriptFormCommand({ mode: 'board' }).args[1];
    expect(
      scriptFormCommand({
        mode: 'board',
        board_verb: 'poll',
        prompt: 'arch',
        board_db: 'hive.sqlite',
      }),
    ).toEqual({
      script: 'board.sh',
      args: ['--db', 'hive.sqlite', 'poll', '--agent', 'arch'],
    });
    expect(
      scriptFormCommand({
        mode: 'board',
        board_verb: 'mentions',
        prompt: 'captain-1',
      }),
    ).toEqual({
      script: 'board.sh',
      args: ['--db', defaultDb, 'mentions', '--agent', 'captain-1'],
    });
  });

  it('maps context action + key/value', () => {
    expect(scriptFormCommand({ mode: 'context' })).toEqual({
      script: 'context.sh',
      args: ['list'],
    });
    expect(
      scriptFormCommand({
        mode: 'context',
        context_action: 'get',
        context_key: 'market',
      }),
    ).toEqual({
      script: 'context.sh',
      args: ['get', 'market'],
    });
    expect(
      scriptFormCommand({
        mode: 'context',
        context_action: 'set',
        context_key: 'phase',
        context_value: 'collect',
      }),
    ).toEqual({
      script: 'context.sh',
      args: ['set', 'phase', 'collect'],
    });
    expect(
      scriptFormCommand({
        mode: 'context',
        context_action: 'snapshot',
      }),
    ).toEqual({
      script: 'context.sh',
      args: ['snapshot'],
    });
  });
});

describe('resolveFusionScriptsRoot precedence', () => {
  it('customRoot takes top precedence if it exists', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fusion-test-custom-'));
    try {
      const res = resolveFusionScriptsRoot({
        customRoot: tmp,
        skipRepoFallback: true,
      });
      expect(res).toBe(tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('FUSION_PLUGIN_ROOT env takes precedence over home directory', () => {
    const tmpEnv = mkdtempSync(join(tmpdir(), 'fusion-test-env-'));
    const tmpHome = mkdtempSync(join(tmpdir(), 'fusion-test-home-'));
    try {
      const envScripts = join(tmpEnv, 'scripts');
      mkdirSync(envScripts, { recursive: true });

      const homeAndrewScripts = join(
        tmpHome,
        '.andrewcode',
        'plugins',
        'managed',
        'fusion',
        'scripts',
      );
      mkdirSync(homeAndrewScripts, { recursive: true });

      const resolved = resolveFusionScriptsRoot({
        env: { FUSION_PLUGIN_ROOT: tmpEnv },
        homeDir: tmpHome,
        skipRepoFallback: true,
      });
      expect(resolved).toBe(envScripts);
    } finally {
      rmSync(tmpEnv, { recursive: true, force: true });
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('.andrewcode scripts take precedence over .claude scripts in home dir', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'fusion-test-home-prec-'));
    try {
      const homeAndrewScripts = join(
        tmpHome,
        '.andrewcode',
        'plugins',
        'managed',
        'fusion',
        'scripts',
      );
      mkdirSync(homeAndrewScripts, { recursive: true });

      const homeClaudeScripts = join(
        tmpHome,
        '.claude',
        'plugins',
        'fusion',
        'scripts',
      );
      mkdirSync(homeClaudeScripts, { recursive: true });

      const resolved = resolveFusionScriptsRoot({
        env: {},
        homeDir: tmpHome,
        skipRepoFallback: true,
      });
      expect(resolved).toBe(homeAndrewScripts);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('.claude scripts used when .andrewcode scripts absent', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'fusion-test-home-claude-'));
    try {
      const homeClaudeScripts = join(
        tmpHome,
        '.claude',
        'plugins',
        'fusion',
        'scripts',
      );
      mkdirSync(homeClaudeScripts, { recursive: true });

      const resolved = resolveFusionScriptsRoot({
        env: {},
        homeDir: tmpHome,
        skipRepoFallback: true,
      });
      expect(resolved).toBe(homeClaudeScripts);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('returns undefined when no scripts directory exists and fallback skipped', () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'fusion-test-none-'));
    try {
      const resolved = resolveFusionScriptsRoot({
        env: {},
        homeDir: tmpHome,
        skipRepoFallback: true,
      });
      expect(resolved).toBeUndefined();
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

describe('detectExternalClis script integration', () => {
  it('merges script detect output into providers probe map when fusion.sh exists', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fusion-test-detect-'));
    try {
      // Mock fusion.sh that prints detect JSON
      const script = join(tmp, 'fusion.sh');
      writeFileSync(
        script,
        '#!/usr/bin/env bash\necho \'{"providers":{"claude":"host-native","codex":"available","copilot":"available","opencode":"missing","grok":"available","kimi":"available","andrewcode":"available"},"metaloop":{"agy":"available","fable":"available"},"live_panelists":4,"multi_model":true}\'\n',
        { mode: 0o755 },
      );

      const res = detectExternalClis({ scriptsRoot: tmp });
      expect(res.providers.codex.status).toBe('available');
      expect(res.providers.claude.status).toBe('host-native');
      expect(res.providers.opencode.status).toBe('missing');
      expect(res.metaloop).toBeDefined();
      expect(res.metaloop?.['agy']).toBe('available');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('falls back silently to built-in detect when script does not exist', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'fusion-test-empty-'));
    try {
      const res = detectExternalClis({ scriptsRoot: tmp });
      expect(res.providers).toBeDefined();
      expect(typeof res.livePanelists).toBe('number');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
