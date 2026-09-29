import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  formatScriptFormBrief,
  formatSwarmBrief,
  getDefaultSwarmFormOptions,
  getDefaultSwarmSelection,
  loadLastSwarmSelection,
  saveSwarmSelection,
  SWARM_PATTERNS,
} from '#/tui/utils/fusion-swarm';

const originalStateDir = process.env['FUSION_STATE_DIR'];
const tempDirs: string[] = [];

function makeStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'fusion-swarm-test-'));
  tempDirs.push(dir);
  process.env['FUSION_STATE_DIR'] = dir;
  return dir;
}

afterEach(() => {
  if (originalStateDir === undefined) delete process.env['FUSION_STATE_DIR'];
  else process.env['FUSION_STATE_DIR'] = originalStateDir;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('getDefaultSwarmFormOptions', () => {
  it('returns the script-form defaults', () => {
    expect(getDefaultSwarmFormOptions()).toEqual({
      captains: ['kimi', 'opencode', 'grok', 'copilot'],
      childrenPerCaptain: 4,
      layers: 2,
      dryRun: false,
      ultracodeVerb: 'doctor',
      boardVerb: 'agents',
      contextAction: 'list',
    });
  });
});

describe('SWARM_PATTERNS', () => {
  it('registers ultraswarm, board, and context as script forms', () => {
    const byId = Object.fromEntries(SWARM_PATTERNS.map((pattern) => [pattern.id, pattern]));
    expect(byId['ultraswarm']?.form).toBe('script');
    expect(byId['ultraswarm']?.badge).toBe('UltraSwarm');
    expect(byId['board']?.form).toBe('script');
    expect(byId['board']?.badge).toBe('Board');
    expect(byId['context']?.form).toBe('script');
    expect(byId['context']?.badge).toBe('Context');
  });
});

describe('formatSwarmBrief', () => {
  it('keeps panel-pattern output unchanged', () => {
    const state = getDefaultSwarmSelection();
    state.task = 'Build it';
    expect(formatSwarmBrief(state)).toBe(
      '[Custom Agent Swarm]\n' +
        'Pattern: UltraSwarm / Mixture-of-Agents (MoA)\n' +
        'Providers & Models: Codex (OpenAI) [gpt-5.6-sol], Claude (Anthropic) [claude-3-7-sonnet], ' +
        'Copilot (GitHub / Google) [gemini-3.5-flash], OpenCode (GLM / DeepSeek) [opencode-go/glm-5.2]\n' +
        'AndrewCode session models: (none selected)\n' +
        'Task: Build it\n',
    );
  });

  it('appends hive form, options, and the Fusion-tool instruction', () => {
    const state = getDefaultSwarmSelection();
    state.pattern = 'hive';
    state.formOptions = {
      captains: ['codex', 'grok'],
      childrenPerCaptain: 5,
      layers: 2,
      dryRun: true,
      ultracodeVerb: 'doctor',
    };
    state.task = 'Build the CLI';
    const brief = formatSwarmBrief(state);
    expect(brief).toContain('Form: hive');
    expect(brief).toContain('Form options: Captains: codex, grok | Children per captain: 5 | Dry run: on');
    expect(brief).toContain(
      'Execution: run the task through the Fusion tool with mode=hive and parameters ' +
        'captains=codex,grok, children_per_captain=5, dry_run=true, then synthesize the panelists\' output.',
    );
  });

  it('appends graph form options without captains', () => {
    const state = getDefaultSwarmSelection();
    state.pattern = 'graph';
    state.formOptions.dryRun = false;
    const brief = formatSwarmBrief(state);
    expect(brief).toContain('Form: graph');
    expect(brief).toContain('Form options: Dry run: off');
    expect(brief).toContain('mode=graph and parameters dry_run=false');
    expect(brief).not.toContain('Captains:');
  });

  it('appends the ultracode verb', () => {
    const state = getDefaultSwarmSelection();
    state.pattern = 'ultracode';
    state.formOptions.ultracodeVerb = 'install';
    const brief = formatSwarmBrief(state);
    expect(brief).toContain('Form: ultracode');
    expect(brief).toContain('Form options: UltraCode verb: install');
    expect(brief).toContain('mode=ultracode and parameters verb=install');
  });

  it('instructs Fusion tool mode=ultraswarm', () => {
    const state = getDefaultSwarmSelection();
    state.pattern = 'ultraswarm';
    state.task = 'Design the council';
    const brief = formatSwarmBrief(state);
    expect(brief).toContain('Form: ultraswarm');
    expect(brief).toContain('Form options: Five-agent council');
    expect(brief).toContain(
      "Execution: run the task through the Fusion tool with mode=ultraswarm, then synthesize the panelists' output.",
    );
  });

  it('defaults board briefs to verb=agents', () => {
    const state = getDefaultSwarmSelection();
    state.pattern = 'board';
    const brief = formatSwarmBrief(state);
    expect(brief).toContain('Form: board');
    expect(brief).toContain('Form options: Board verb: agents');
    expect(brief).toContain('mode=board and parameters board_verb=agents');
  });

  it('instructs Fusion tool mode=board with verb and db', () => {
    const state = getDefaultSwarmSelection();
    state.pattern = 'board';
    state.formOptions.boardVerb = 'poll';
    state.formOptions.boardDb = '/tmp/hive.sqlite';
    const brief = formatSwarmBrief(state);
    expect(brief).toContain('Form: board');
    expect(brief).toContain('Form options: Board verb: poll | db: /tmp/hive.sqlite');
    expect(brief).toContain(
      'mode=board and parameters board_verb=poll, board_db=/tmp/hive.sqlite',
    );
  });

  it('instructs Fusion tool mode=context with action/key/value', () => {
    const state = getDefaultSwarmSelection();
    state.pattern = 'context';
    state.formOptions.contextAction = 'set';
    state.formOptions.contextKey = 'goal';
    state.formOptions.contextValue = 'ship swarm';
    const brief = formatSwarmBrief(state);
    expect(brief).toContain('Form: context');
    expect(brief).toContain('Form options: Context action: set | key: goal | value: ship swarm');
    expect(brief).toContain(
      'mode=context and parameters context_action=set, context_key=goal, context_value=ship swarm',
    );
  });

  it('keeps designer/metaloop on the generic dry-run Fusion instruction', () => {
    const designer = getDefaultSwarmSelection();
    designer.pattern = 'designer';
    expect(formatSwarmBrief(designer)).toContain('mode=designer and parameters dry_run=false');
    const metaloop = getDefaultSwarmSelection();
    metaloop.pattern = 'metaloop';
    metaloop.formOptions.dryRun = true;
    expect(formatSwarmBrief(metaloop)).toContain('mode=metaloop and parameters dry_run=true');
  });

  it('appends thinking_effort on script-form briefs', () => {
    const state = getDefaultSwarmSelection();
    state.pattern = 'hive';
    state.formOptions.thinkingEffort = 'high';
    const brief = formatScriptFormBrief(state);
    expect(brief).toContain('Thinking: high');
    expect(brief).toContain('thinking_effort=high');
  });
});

describe('form option persistence', () => {
  it('round-trips form options through last_selection.json', () => {
    makeStateDir();
    const state = getDefaultSwarmSelection();
    state.pattern = 'hive';
    state.task = 'Build it';
    state.formOptions = {
      captains: ['grok'],
      childrenPerCaptain: 7,
      layers: 3,
      dryRun: true,
      ultracodeVerb: 'launch',
      thinkingEffort: 'xhigh',
      boardVerb: 'channels',
      boardDb: 'hive.sqlite',
      contextAction: 'snapshot',
      contextKey: 'roster',
      contextValue: 'ceo,coo',
    };
    saveSwarmSelection(state);

    const loaded = loadLastSwarmSelection();
    expect(loaded.pattern).toBe('hive');
    expect(loaded.task).toBe('Build it');
    expect(loaded.formOptions).toEqual(state.formOptions);
  });

  it('persists snake_case thinking_effort, board_*, and context_* keys', () => {
    const stateDir = makeStateDir();
    const state = getDefaultSwarmSelection();
    state.formOptions.thinkingEffort = 'medium';
    state.formOptions.boardVerb = 'tree';
    state.formOptions.boardDb = 'board.sqlite';
    state.formOptions.contextAction = 'get';
    state.formOptions.contextKey = 'owner';
    state.formOptions.contextValue = 'andrew';
    saveSwarmSelection(state);

    const raw = JSON.parse(
      readFileSync(join(stateDir, 'ultraswarm', 'last_selection.json'), 'utf8'),
    ) as { form_options: Record<string, unknown> };
    expect(raw.form_options).toMatchObject({
      thinking_effort: 'medium',
      board_verb: 'tree',
      board_db: 'board.sqlite',
      context_action: 'get',
      context_key: 'owner',
      context_value: 'andrew',
    });
  });

  it('falls back to defaults when form_options is missing or malformed', () => {
    const stateDir = makeStateDir();
    const ultraDir = join(stateDir, 'ultraswarm');
    mkdirSync(ultraDir, { recursive: true });
    writeFileSync(
      join(ultraDir, 'last_selection.json'),
      JSON.stringify({
        pattern: 'hive',
        form_options: {
          captains: ['nope', 'codex'],
          children_per_captain: -2,
          layers: 'not-a-number',
          dry_run: 'yes',
          ultracode_verb: 'frobnicate',
          thinking_effort: '',
          board_verb: 'not-a-verb',
          board_db: '',
          context_action: 'explode',
          context_key: '',
        },
      }),
      'utf8',
    );

    const loaded = loadLastSwarmSelection();
    expect(loaded.pattern).toBe('hive');
    // Valid captains survive; every other invalid field keeps its default.
    expect(loaded.formOptions).toEqual({
      captains: ['codex'],
      childrenPerCaptain: 4,
      layers: 2,
      dryRun: false,
      ultracodeVerb: 'doctor',
      boardVerb: 'agents',
      contextAction: 'list',
    });
  });

  it('uses defaults when form_options is absent entirely', () => {
    const stateDir = makeStateDir();
    const ultraDir = join(stateDir, 'ultraswarm');
    mkdirSync(ultraDir, { recursive: true });
    writeFileSync(
      join(ultraDir, 'last_selection.json'),
      JSON.stringify({ pattern: 'graph', task: 'x' }),
      'utf8',
    );

    const loaded = loadLastSwarmSelection();
    expect(loaded.formOptions).toEqual(getDefaultSwarmFormOptions());
  });
});