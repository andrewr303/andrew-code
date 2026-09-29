import type { ModelAlias } from '@moonshot-ai/kimi-code-sdk';
import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CustomSwarmDialogComponent } from '#/tui/components/dialogs/custom-swarm-dialog';
import { SwarmConfigDialogComponent } from '#/tui/components/dialogs/swarm-config-dialog';
import { currentTheme } from '#/tui/theme';
import { darkColors, lightColors } from '#/tui/theme/colors';
import { type SwarmPattern, SWARM_PATTERNS } from '#/tui/utils/fusion-swarm';

const ESC = String.fromCodePoint(27);
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replaceAll(SGR, '');
const TAB = '\t';
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const ENTER = '\r';
const RIGHT = `${ESC}[C`;
const LEFT = `${ESC}[D`;
const SHIFT_TAB = `${ESC}[Z`;
const PAGE_DOWN = `${ESC}[6~`;

function model(displayName: string, provider: string, supportEfforts?: readonly string[]): ModelAlias {
  return {
    provider,
    model: displayName.toLowerCase().replaceAll(' ', '-'),
    maxContextSize: 200_000,
    displayName,
    capabilities: ['thinking'],
    supportEfforts,
  } as unknown as ModelAlias;
}

function make(overrides: { currentValue?: string; models?: Record<string, ModelAlias> } = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const component = new SwarmConfigDialogComponent({
    models: overrides.models ?? {
      k3: model('Kimi K3', 'managed:kimi-code'),
      astra: model('GPT-6 Astra', 'azure'),
      glm: model('GLM 5.3', 'cloudflare-workers-ai'),
    },
    currentValue: overrides.currentValue ?? 'k3',
    onConfirm,
    onCancel,
  });
  component.focused = true;
  return { component, onConfirm, onCancel };
}

function openNativeRoles(component: SwarmConfigDialogComponent, patternId = 'fusion'): void {
  component.handleInput(TAB);
  const index = SWARM_PATTERNS.findIndex((pattern) => pattern.id === patternId);
  for (let i = 0; i < index; i++) component.handleInput(DOWN);
  component.handleInput(ENTER);
  component.handleInput(SHIFT_TAB);
}

function search(component: SwarmConfigDialogComponent, text: string): void {
  for (const char of text) component.handleInput(char);
}

function confirmRoles(component: SwarmConfigDialogComponent): void {
  component.handleInput(TAB);
  component.handleInput(TAB);
  component.handleInput(ENTER);
}

function selectPattern(component: SwarmConfigDialogComponent, patternId: string): void {
  while ((component as unknown as { activePanel: string }).activePanel !== 'pattern') {
    component.handleInput(TAB);
  }
  const patterns = SWARM_PATTERNS;
  const targetIndex = patterns.findIndex((pattern) => pattern.id === patternId);
  const currentIndex = (component as unknown as { patternList: { view(): { selectedIndex: number } } }).patternList.view().selectedIndex;
  const delta = targetIndex - currentIndex;
  const key = delta > 0 ? DOWN : UP;
  for (let i = 0; i < Math.abs(delta); i++) component.handleInput(key);
  component.handleInput(ENTER);
}

function makeCustom(overrides: { initialTask?: string; initialPattern?: SwarmPattern | string; models?: Record<string, ModelAlias> } = {}) {
  const onStart = vi.fn();
  const onCancel = vi.fn();
  const component = new CustomSwarmDialogComponent({
    models: overrides.models ?? {
      k3: model('Kimi K3', 'managed:kimi-code'),
      astra: model('GPT-6 Astra', 'azure'),
    },
    initialTask: overrides.initialTask,
    initialPattern: (overrides.initialPattern ?? 'moa') as SwarmPattern,
    onStart,
    onCancel,
  });
  component.focused = true;
  return { component, onStart, onCancel };
}

function clickCustomStart(component: CustomSwarmDialogComponent): void {
  const rows = (component as unknown as { rows: readonly { kind: string }[] }).rows;
  const startIdx = rows.findIndex((r) => r.kind === 'start_btn');
  (component as unknown as { selectedIndex: number }).selectedIndex = startIdx;
  component.handleInput(ENTER);
}

describe('SwarmConfigDialogComponent', () => {
  let previousLevel: typeof chalk.level;
  const previousPalette = currentTheme.palette;
  beforeAll(() => {
    previousLevel = chalk.level;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
  });
  afterAll(() => {
    chalk.level = previousLevel;
    currentTheme.setPalette(previousPalette);
  });

  it('opens on the Models panel of a three-panel strip', () => {
    const { component } = make();
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Models');
    expect(out).toContain('Pattern');
    expect(out).toContain('Start');
    expect(out).toContain('Kimi K3');
    expect(strip(component.render(120).join('\n')).indexOf('GPT-6 Astra')).toBeGreaterThan(0);
  });

  it('multi-selects models with Enter, listing them on the picked rows', () => {
    const { component } = make();
    component.handleInput(ENTER); // toggle first row (Kimi K3)
    component.handleInput(DOWN);
    component.handleInput(ENTER); // toggle second row (GPT-6 Astra)
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('✓');
    expect(out).toContain('GPT-6 Astra');
  });

  it('confirms with the picked models, pattern, and falls back to the current model', () => {
    const picked = make({ currentValue: 'k3' });
    picked.component.handleInput(DOWN);
    picked.component.handleInput(ENTER); // pick GPT-6 Astra
    picked.component.handleInput(TAB); // Pattern panel
    picked.component.handleInput(DOWN);
    picked.component.handleInput(ENTER); // second pattern
    picked.component.handleInput(TAB); // Start panel
    const summary = strip(picked.component.render(120).join('\n'));
    expect(summary).toContain('GPT-6 Astra');
    expect(summary).toContain(SWARM_PATTERNS[1]!.label);
    picked.component.handleInput(ENTER); // confirm
    expect(picked.onConfirm).toHaveBeenCalledWith({
      models: ['astra'],
      pattern: SWARM_PATTERNS[1]!.id,
    });

    const nonePicked = make({ currentValue: 'k3' });
    nonePicked.component.handleInput(TAB);
    nonePicked.component.handleInput(TAB);
    nonePicked.component.handleInput(ENTER);
    expect(nonePicked.onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      models: ['k3'],
      pattern: SWARM_PATTERNS[0]!.id,
      formOptions: expect.objectContaining({ layers: 2 }),
    }));
  });

  it.each([
    ['fusion', true], ['fusion', false],
    ['fusion-idiot-boss', true], ['fusion-idiot-boss', false],
  ] as const)('confirms %s with engine-owned models (picked=%s)', (patternId, picked) => {
    const { component, onConfirm } = make();
    if (picked) component.handleInput(ENTER);
    component.handleInput(TAB);
    const patternIndex = SWARM_PATTERNS.findIndex((pattern) => pattern.id === patternId);
    for (let i = 0; i < patternIndex; i++) component.handleInput(DOWN);
    component.handleInput(ENTER);
    const pattern = strip(component.render(120).join('\n'));
    expect(pattern).toContain(SWARM_PATTERNS[patternIndex]!.label);
    expect(pattern).toContain(SWARM_PATTERNS[patternIndex]!.description);
    component.handleInput(TAB);
    const summary = strip(component.render(120).join('\n'));
    expect(summary).toContain('Native role preset (engine-owned)');
    expect(summary).toContain('Session model picks are ignored');
    expect(summary).toContain('Strategy fixed for team lifetime; changes are rejected');
    expect(summary).not.toContain('Kimi K3');
    if (patternId === 'fusion') {
      expect(summary).toContain('Astra CEO / Opus 5.5 COO; bounded delegation');
      expect(summary).toContain('Opus owns design, implementation and review');
    } else {
      expect(summary).toContain('Coordinator: GPT-6 Luna high');
      expect(summary).toContain('Coordinator fallback: Flash / Muse / Terra');
      expect(summary).toContain('Persistent Opus 5.5 implements continuously');
      expect(summary).toContain('Astra on demand for consequential review');
    }
    component.handleInput(ENTER);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith({ pattern: patternId, models: [], roles: {}, dual: false });
    component.handleInput(TAB);
    expect(strip(component.render(120).join('\n'))).toContain('session model picks are ignored');
  });

  it.each(['fusion', 'fusion-idiot-boss'] as const)(
    'preserves model picks when switching from %s back to a legacy pattern', (patternId) => {
      const { component, onConfirm } = make();
      component.handleInput(ENTER);
      component.handleInput(TAB);
      const patternIndex = SWARM_PATTERNS.findIndex((pattern) => pattern.id === patternId);
      const legacyIndex = SWARM_PATTERNS.findIndex((pattern) => pattern.id === 'flow');
      for (let i = 0; i < patternIndex; i++) component.handleInput(DOWN);
      component.handleInput(ENTER);
      for (let i = legacyIndex; i < patternIndex; i++) component.handleInput(UP);
      component.handleInput(ENTER);
      component.handleInput(TAB);
      component.handleInput(ENTER);
      expect(onConfirm).toHaveBeenCalledWith({ pattern: 'flow', models: ['k3'] });
    },
  );

  it.each([
    ['fusion', ['CEO:', 'COO:', 'Worker:']],
    ['fusion-idiot-boss', ['Coordinator:', 'Implementer:', 'CEO on demand:']],
  ] as const)('shows role labels in strategy order for %s', (pattern, labels) => {
    const { component } = make();
    openNativeRoles(component, pattern);
    const output = strip(component.render(120).join('\n'));
    expect(output).toContain('Fusion roles');
    expect(output).toContain('Dual mode  disabled');
    expect(output).not.toContain('Consultant:');
    expect(output.indexOf(labels[0])).toBeLessThan(output.indexOf(labels[1]));
    expect(output.indexOf(labels[1])).toBeLessThan(output.indexOf(labels[2]));
    for (const label of labels) expect(output).toContain(`${label} (config default)`);
  });

  it('selects a real catalog alias and supported effort without offering off', () => {
    const { component, onConfirm } = make({ models: {
      AstraAlias: model('Astra', 'azure', ['off', 'low', 'high']),
    } });
    openNativeRoles(component);
    component.handleInput(ENTER);
    search(component, 'AstraAlias');
    component.handleInput(RIGHT);
    component.handleInput(RIGHT);
    const picker = strip(component.render(120).join('\n'));
    expect(picker).toContain('[AstraAlias]');
    expect(picker).toContain('azure');
    expect(picker).toContain('[high]');
    expect(picker).not.toMatch(/\boff\b/);
    component.handleInput(ENTER);
    expect(strip(component.render(120).join('\n'))).toContain('CEO: AstraAlias@high');
    confirmRoles(component);
    expect(onConfirm).toHaveBeenCalledWith({
      pattern: 'fusion', models: [], dual: false,
      roles: { ceo: { model: 'AstraAlias', effort: 'high' } },
    });
  });

  it('leaves effort unset for models with no declared efforts', () => {
    const { component, onConfirm } = make();
    openNativeRoles(component);
    component.handleInput(ENTER);
    search(component, 'k3');
    component.handleInput(RIGHT);
    expect(strip(component.render(120).join('\n'))).toContain('Effort: [(config default)]');
    component.handleInput(ENTER);
    confirmRoles(component);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ roles: { ceo: { model: 'k3', effort: undefined } } }));
  });

  it('resets efforts when changing aliases and cycles back to config default', () => {
    const { component, onConfirm } = make({ models: {
      first: model('First', 'azure', ['high']),
      second: model('Second', 'azure'),
    } });
    openNativeRoles(component);
    component.handleInput(ENTER);
    component.handleInput(DOWN);
    component.handleInput(RIGHT);
    component.handleInput(DOWN);
    expect(strip(component.render(120).join('\n'))).not.toContain('[high]');
    component.handleInput(ENTER);
    expect(strip(component.render(120).join('\n'))).toContain('second (default effort)');
    component.handleInput(RIGHT);
    confirmRoles(component);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ roles: {} }));
  });

  it('clears search before cancelling the uncommitted nested picker', () => {
    const { component, onConfirm, onCancel } = make();
    openNativeRoles(component);
    component.handleInput(ENTER);
    search(component, 'astra');
    component.handleInput(ESC);
    expect(strip(component.render(120).join('\n'))).toContain('(type to search)');
    component.handleInput(ESC);
    expect(onCancel).not.toHaveBeenCalled();
    expect(strip(component.render(120).join('\n'))).toContain('CEO: (config default)');
    confirmRoles(component);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ roles: {} }));
  });

  it.each([true, false])('includes the consultant override only when dual remains enabled (%s)', (enabled) => {
    const { component, onConfirm } = make();
    openNativeRoles(component);
    for (let i = 0; i < 3; i++) component.handleInput(DOWN);
    component.handleInput(' ');
    component.handleInput(DOWN);
    component.handleInput(RIGHT);
    expect(strip(component.render(120).join('\n'))).toContain('Consultant: k3');
    if (!enabled) {
      component.handleInput(UP);
      component.handleInput(' ');
      expect(strip(component.render(120).join('\n'))).not.toContain('Consultant:');
    }
    confirmRoles(component);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      dual: enabled, roles: enabled ? { muse: { model: 'k3' } } : {},
    }));
  });

  it('keeps defaults and dual usable with an empty catalog', () => {
    const { component, onConfirm } = make({ models: {} });
    openNativeRoles(component);
    expect(strip(component.render(80).join('\n'))).toContain('No models configured');
    component.handleInput(RIGHT);
    component.handleInput(ENTER);
    expect(strip(component.render(80).join('\n'))).toContain('(config default)');
    component.handleInput(ENTER);
    for (let i = 0; i < 3; i++) component.handleInput(DOWN);
    component.handleInput(ENTER);
    confirmRoles(component);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ roles: {}, dual: true }));
  });

  it('paginates every real model in the role picker and fits narrow widths', () => {
    const models = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [
      `alias${index}`, model(`Model ${index}`, 'azure'),
    ]));
    const { component, onConfirm } = make({ models });
    openNativeRoles(component);
    component.handleInput(ENTER);
    expect(strip(component.render(80).join('\n'))).toContain('Page 1 / 4');
    component.handleInput(PAGE_DOWN);
    expect(strip(component.render(80).join('\n'))).toContain('Page 2 / 4');
    for (const line of component.render(24)) expect(strip(line).length).toBeLessThanOrEqual(24);
    search(component, 'alias29');
    expect(strip(component.render(120).join('\n'))).toContain('[alias29]');
    component.handleInput(ENTER);
    confirmRoles(component);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ roles: { ceo: { model: 'alias29', effort: undefined } } }));
  });

  it('cycles panels with Tab and cancels on Esc from the models panel (second press)', () => {
    const { component, onCancel } = make();
    component.handleInput('g'); // search typing
    component.handleInput(ESC); // clears the query, stays open
    expect(onCancel).not.toHaveBeenCalled();
    component.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Esc cancels directly from non-searchable panels', () => {
    const { component, onCancel } = make();
    component.handleInput(TAB); // Pattern
    component.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('renders without the tab strip when only the light palette is swapped', () => {
    const { component } = make();
    currentTheme.setPalette(lightColors);
    const out = strip(component.render(100).join('\n'));
    currentTheme.setPalette(darkColors);
    expect(out).toContain('Models');
    expect(out).toContain('Start');
  });

  it('includes new script swarm patterns in the pattern picker', () => {
    const { component } = make();
    const allLabels = SWARM_PATTERNS.map((p) => p.label);
    expect(allLabels).toContain('Nested Swarm Hive');
    expect(allLabels).toContain('Task Graph (DAG)');
    expect(allLabels).toContain('UltraCode Shim Engine');
    expect(allLabels).toContain('Swarm Designer (Architect)');
    expect(allLabels).toContain('MetaLoop Strategic Swarm');
    expect(allLabels).toContain('UltraSwarm Five-Agent Council');
    expect(allLabels).toContain('Hive Board');
    expect(allLabels).toContain('Agency Context');

    selectPattern(component, 'hive');
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Nested Swarm Hive');
    expect(out).toContain('[Script]');
    expect(out).toContain('Native');
    expect(out).toContain('Panel');
    expect(out).toContain('Script');
  });

  it('renders compact options row for script forms and hides for panel patterns', () => {
    const { component } = make();
    selectPattern(component, 'hive');
    const hivePatternOut = strip(component.render(120).join('\n'));
    expect(hivePatternOut).toContain('Options:');
    expect(hivePatternOut).toContain('Captains:');
    expect(hivePatternOut).toContain('Children: 4');
    expect(hivePatternOut).toContain('Dry run: disabled');
    expect(hivePatternOut).not.toContain('Verb:');

    component.handleInput(TAB); // Start panel
    const hiveStartOut = strip(component.render(120).join('\n'));
    expect(hiveStartOut).toContain('Options:');
    expect(hiveStartOut).toContain('Captains: [kimi,opencode,grok,copilot]');
    expect(hiveStartOut).toContain('Children: 4');
    expect(hiveStartOut).toContain('Dry run: disabled');

    // Panel pattern (e.g. flow) hides options row
    selectPattern(component, 'flow');
    const flowPatternOut = strip(component.render(120).join('\n'));
    expect(flowPatternOut).not.toContain('Options:');
    expect(flowPatternOut).not.toContain('Captains:');

    component.handleInput(TAB); // Start
    const flowStartOut = strip(component.render(120).join('\n'));
    expect(flowStartOut).not.toContain('Options:');
    expect(flowStartOut).not.toContain('Captains:');

    // Ultracode pattern shows verb
    selectPattern(component, 'ultracode');
    component.handleInput(TAB); // Start
    const ultracodeStartOut = strip(component.render(120).join('\n'));
    expect(ultracodeStartOut).toContain('Verb: doctor');
    expect(ultracodeStartOut).not.toContain('Children:');
  });

  it('emits formOptions for script forms and omits it for panel patterns', () => {
    // Script pattern: hive
    const hiveTest = make({ currentValue: 'k3' });
    selectPattern(hiveTest.component, 'hive');
    hiveTest.component.handleInput(TAB); // Start panel
    hiveTest.component.handleInput(ENTER); // Confirm
    expect(hiveTest.onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      models: ['k3'],
      pattern: 'hive',
      formOptions: expect.objectContaining({
        captains: ['kimi', 'opencode', 'grok', 'copilot'],
        childrenPerCaptain: 4,
        layers: 2,
        dryRun: false,
        ultracodeVerb: 'doctor',
      }),
    }));

    // Panel pattern: flow
    const flowTest = make({ currentValue: 'k3' });
    selectPattern(flowTest.component, 'flow');
    flowTest.component.handleInput(TAB); // Start panel
    flowTest.component.handleInput(ENTER); // Confirm
    expect(flowTest.onConfirm).toHaveBeenCalledWith({
      models: ['k3'],
      pattern: 'flow',
    });
    expect(flowTest.onConfirm.mock.calls[0]![0]).not.toHaveProperty('formOptions');
  });

  it('allows modifying compact options on start panel before confirm', () => {
    const { component, onConfirm } = make({ currentValue: 'k3' });
    selectPattern(component, 'hive');
    component.handleInput(TAB); // Start panel

    // '+' increments children
    component.handleInput('+');
    // 'd' toggles dry-run
    component.handleInput('d');

    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Children: 5');
    expect(out).toContain('Dry run: enabled');

    component.handleInput(ENTER); // Confirm
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      models: ['k3'],
      pattern: 'hive',
      formOptions: expect.objectContaining({
        childrenPerCaptain: 5,
        dryRun: true,
      }),
    }));
  });

  it('allows cycling ultracode verb on start panel with v key', () => {
    const { component, onConfirm } = make({ currentValue: 'k3' });
    selectPattern(component, 'ultracode');
    component.handleInput(TAB); // Start panel

    component.handleInput('v'); // cycles doctor -> test
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Verb: test');

    component.handleInput(ENTER); // Confirm
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      models: ['k3'],
      pattern: 'ultracode',
      formOptions: expect.objectContaining({
        ultracodeVerb: 'test',
      }),
    }));
  });

  it('allows editing captains CSV input on start panel', () => {
    const { component, onConfirm } = make({ currentValue: 'k3' });
    selectPattern(component, 'graph');
    component.handleInput(TAB); // Start panel

    component.setCaptains('codex,grok');
    component.handleInput(ENTER);

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      models: ['k3'],
      pattern: 'graph',
      formOptions: expect.objectContaining({
        captains: ['codex', 'grok'],
      }),
    }));
  });

  it('shows board, context, and ultraswarm options on the Start panel', () => {
    const { component } = make();
    selectPattern(component, 'board');
    component.handleInput(TAB);
    const boardOut = strip(component.render(120).join('\n'));
    expect(boardOut).toContain('Options:');
    expect(boardOut).toContain('Board: agents');
    expect(boardOut).toContain('Dry run: disabled');
    expect(boardOut).toContain('[ Enter swarm mode ]');

    selectPattern(component, 'context');
    component.handleInput(TAB);
    const contextOut = strip(component.render(120).join('\n'));
    expect(contextOut).toContain('Context: list');
    expect(contextOut).toContain('Dry run:');

    selectPattern(component, 'ultraswarm');
    component.handleInput(TAB);
    const ultraOut = strip(component.render(120).join('\n'));
    expect(ultraOut).toContain('Five-agent council');
    expect(ultraOut).toContain('Dry run: disabled');
  });

  it('toggles dry-run on every script form and cycles board/context verbs', () => {
    const board = make({ currentValue: 'k3' });
    selectPattern(board.component, 'board');
    board.component.handleInput(TAB);
    board.component.handleInput('d');
    board.component.handleInput('b');
    expect(strip(board.component.render(120).join('\n'))).toContain('Board: poll');
    expect(strip(board.component.render(120).join('\n'))).toContain('Dry run: enabled');
    board.component.handleInput(ENTER);
    expect(board.onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      pattern: 'board',
      formOptions: expect.objectContaining({
        dryRun: true,
        boardVerb: 'poll',
      }),
    }));

    const context = make({ currentValue: 'k3' });
    selectPattern(context.component, 'context');
    context.component.handleInput(TAB);
    context.component.handleInput('a');
    expect(strip(context.component.render(120).join('\n'))).toContain('Context: get');
    context.component.handleInput(ENTER);
    expect(context.onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      pattern: 'context',
      formOptions: expect.objectContaining({
        contextAction: 'get',
      }),
    }));
  });

  it('cycles session-model thinking effort with ←→ and stores it on confirm', () => {
    const { component, onConfirm } = make({
      models: {
        k3: model('Kimi K3', 'managed:kimi-code', ['low', 'high']),
      },
      currentValue: 'k3',
    });
    const before = strip(component.render(120).join('\n'));
    expect(before).toContain('Thinking  (←→ to switch)');
    expect(before).toContain('[ High ]');
    component.handleInput(LEFT);
    const after = strip(component.render(120).join('\n'));
    expect(after).toContain('[ Low ]');
    component.handleInput(TAB);
    component.handleInput(TAB);
    component.handleInput(ENTER);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      models: ['k3'],
      modelThinking: { k3: 'low' },
      thinkingEffort: 'low',
    }));
  });

  it('keeps native role effort labels and the global ←→ effort hint', () => {
    const { component } = make();
    openNativeRoles(component);
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('CEO: (config default)');
    expect(out).toContain('←→ effort');
    expect(out).toContain('Tab switch panel');
  });
});

describe('CustomSwarmDialogComponent', () => {
  let previousLevel: typeof chalk.level;
  const previousPalette = currentTheme.palette;
  beforeAll(() => {
    previousLevel = chalk.level;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
  });
  afterAll(() => {
    chalk.level = previousLevel;
    currentTheme.setPalette(previousPalette);
  });

  it('renders layers option for default moa pattern and hides other options', () => {
    const { component } = makeCustom({ initialPattern: 'moa' });
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Layers:');
    expect(out).toContain('← 2 →');
    expect(out).not.toContain('Captain Providers (Hive/Designer):');
    expect(out).not.toContain('Children per captain:');
    expect(out).not.toContain('Dry run:');
    expect(out).not.toContain('Ultracode verb:');
  });

  it('adjusts layers with arrow keys and emits formOptions on start', () => {
    const { component, onStart } = makeCustom({ initialPattern: 'moa' });
    component.handleInput(DOWN); // Move to layers row
    component.handleInput(RIGHT); // Increment layers: 2 -> 3
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('← 3 →');

    // Click start button
    clickCustomStart(component);

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        formOptions: expect.objectContaining({
          layers: 3,
        }),
      }),
    );
  });

  it('cycles to hive pattern and exposes captains, children, dryRun while hiding layers and verb', () => {
    const { component } = makeCustom({ initialPattern: 'hive' });
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Captain Providers (Hive/Designer):');
    expect(out).toContain('Children per captain:');
    expect(out).toContain('Dry run:');
    expect(out).not.toContain('Layers:');
    expect(out).not.toContain('Ultracode verb:');
  });

  it('toggles dryRun and adjusts children in hive pattern', () => {
    const { component, onStart } = makeCustom({ initialPattern: 'hive' });
    // Navigate down through captains (7 rows) to children row
    for (let i = 0; i < 8; i++) component.handleInput(DOWN);
    component.handleInput(RIGHT); // children: 4 -> 5
    component.handleInput(DOWN); // dry_run row
    component.handleInput(' '); // toggle dry_run -> true

    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('← 5 →');
    expect(out).toContain('Dry run:  enabled');

    clickCustomStart(component);

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'hive',
        formOptions: expect.objectContaining({
          childrenPerCaptain: 5,
          dryRun: true,
        }),
      }),
    );
  });

  it('cycles to ultracode and exposes verb picker', () => {
    const { component, onStart } = makeCustom({ initialPattern: 'ultracode' });
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Ultracode verb:');
    expect(out).toContain('← doctor →');

    component.handleInput(DOWN); // Move to ultracode_verb row
    component.handleInput(RIGHT); // doctor -> test
    const testOut = strip(component.render(120).join('\n'));
    expect(testOut).toContain('← test →');

    clickCustomStart(component);

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'ultracode',
        formOptions: expect.objectContaining({
          ultracodeVerb: 'test',
        }),
      }),
    );
  });

  it('hides options panel when pattern has no relevant options (e.g. flow) and emits defaults', () => {
    const { component, onStart } = makeCustom({ initialPattern: 'flow' });
    const out = strip(component.render(120).join('\n'));
    expect(out).not.toContain('Layers:');
    expect(out).not.toContain('Children per captain:');
    expect(out).not.toContain('Dry run:');
    expect(out).not.toContain('Ultracode verb:');
    expect(out).not.toContain('Captain Providers (Hive/Designer):');

    clickCustomStart(component);

    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'flow',
        formOptions: expect.objectContaining({
          captains: ['kimi', 'opencode', 'grok', 'copilot'],
          childrenPerCaptain: 4,
          layers: 2,
          dryRun: false,
          ultracodeVerb: 'doctor',
        }),
      }),
    );
  });

  it('cancels on Esc', () => {
    const { component, onCancel } = makeCustom();
    component.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
