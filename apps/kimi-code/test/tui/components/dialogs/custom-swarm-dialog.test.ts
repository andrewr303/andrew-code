import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ModelAlias } from '@moonshot-ai/kimi-code-sdk';
import chalk from 'chalk';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { CustomSwarmDialogComponent } from '#/tui/components/dialogs/custom-swarm-dialog';
import { currentTheme } from '#/tui/theme';
import { darkColors } from '#/tui/theme/colors';
import { type SwarmPattern, SWARM_PATTERNS } from '#/tui/utils/fusion-swarm';

const ESC = String.fromCodePoint(27);
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const strip = (s: string): string => s.replaceAll(SGR, '');
const DOWN = `${ESC}[B`;
const ENTER = '\r';
const RIGHT = `${ESC}[C`;
const LEFT = `${ESC}[D`;

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

function makeCustom(
  overrides: { initialTask?: string; initialPattern?: SwarmPattern | string; models?: Record<string, ModelAlias> } = {},
  isolateState?: () => void,
) {
  isolateState?.();
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

describe('CustomSwarmDialogComponent', () => {
  let previousLevel: typeof chalk.level;
  const previousPalette = currentTheme.palette;
  const originalStateDir = process.env['FUSION_STATE_DIR'];
  const tempDirs: string[] = [];

  beforeAll(() => {
    previousLevel = chalk.level;
    chalk.level = 3;
    currentTheme.setPalette(darkColors);
  });
  afterAll(() => {
    chalk.level = previousLevel;
    currentTheme.setPalette(previousPalette);
  });
  afterEach(() => {
    if (originalStateDir === undefined) delete process.env['FUSION_STATE_DIR'];
    else process.env['FUSION_STATE_DIR'] = originalStateDir;
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function withTempState(): void {
    const dir = mkdtempSync(join(tmpdir(), 'custom-swarm-dialog-'));
    tempDirs.push(dir);
    process.env['FUSION_STATE_DIR'] = dir;
  }

  it('filters native fusion patterns from the custom picker', () => {
    const native = SWARM_PATTERNS.filter((pattern) => pattern.form === 'native' || pattern.badge === 'Native');
    expect(native.length).toBeGreaterThan(0);
    const { component } = makeCustom({ initialPattern: 'moa' }, withTempState);
    const out = strip(component.render(120).join('\n'));
    expect(out).not.toContain('Native Fusion team');
    expect(out).toContain('[ Start Custom Swarm ]');
    expect(out).toContain('[ Cancel ]');
  });

  it('lists ultraswarm, board, and context as custom patterns with form rows', () => {
    const { component } = makeCustom({ initialPattern: 'ultraswarm' }, withTempState);
    const ultra = strip(component.render(120).join('\n'));
    expect(ultra).toContain('UltraSwarm Five-Agent Council');
    expect(ultra).toContain('[UltraSwarm]');
    expect(ultra).toContain('Five-agent council via ultraswarm.sh');
    expect(ultra).toContain('Dry run:');
    expect(ultra).toContain('[ Start Custom Swarm ]');
    expect(ultra).toContain('[ Cancel ]');
    expect(ultra).not.toContain('Native Fusion team');

    const { component: board } = makeCustom({ initialPattern: 'board' }, withTempState);
    const boardOut = strip(board.render(120).join('\n'));
    expect(boardOut).toContain('Hive Board');
    expect(boardOut).toContain('[Board]');
    expect(boardOut).toContain('Board verb:');
    expect(boardOut).toContain('← agents →');
    expect(boardOut).toContain('Board db:');

    const { component: context } = makeCustom({ initialPattern: 'context' }, withTempState);
    const contextOut = strip(context.render(120).join('\n'));
    expect(contextOut).toContain('Agency Context');
    expect(contextOut).toContain('[Context]');
    expect(contextOut).toContain('Context action:');
    expect(contextOut).toContain('← list →');
    expect(contextOut).not.toContain('Context key:');
  });

  it('cycles board verb and context action, and types context key/value for set', () => {
    const board = makeCustom({ initialPattern: 'board' }, withTempState);
    board.component.handleInput(DOWN);
    board.component.handleInput(RIGHT);
    expect(strip(board.component.render(120).join('\n'))).toContain('← poll →');
    clickCustomStart(board.component);
    expect(board.onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'board',
        formOptions: expect.objectContaining({
          boardVerb: 'poll',
        }),
      }),
    );

    const context = makeCustom({ initialPattern: 'context' }, withTempState);
    context.component.handleInput(DOWN);
    context.component.handleInput(RIGHT);
    expect(strip(context.component.render(120).join('\n'))).toContain('← get →');
    expect(strip(context.component.render(120).join('\n'))).toContain('Context key:');
    context.component.handleInput(RIGHT);
    expect(strip(context.component.render(120).join('\n'))).toContain('← set →');
    expect(strip(context.component.render(120).join('\n'))).toContain('Context value:');
    context.component.handleInput(DOWN);
    context.component.handleInput('k');
    context.component.handleInput('1');
    context.component.handleInput(DOWN);
    context.component.handleInput('v');
    clickCustomStart(context.component);
    expect(context.onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'context',
        formOptions: expect.objectContaining({
          contextAction: 'set',
          contextKey: 'k1',
          contextValue: 'v',
        }),
      }),
    );
  });

  it('toggles ultraswarm dry-run and keeps the council note', () => {
    const { component, onStart } = makeCustom({ initialPattern: 'ultraswarm' }, withTempState);
    component.handleInput(DOWN);
    component.handleInput(' ');
    const out = strip(component.render(120).join('\n'));
    expect(out).toContain('Dry run:  enabled');
    expect(out).toContain('Five-agent council via ultraswarm.sh');
    clickCustomStart(component);
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'ultraswarm',
        formOptions: expect.objectContaining({
          dryRun: true,
        }),
      }),
    );
  });

  it('cycles per-provider thinking/effort with ←→ and stores thinkingEffort', () => {
    const { component, onStart } = makeCustom({ initialPattern: 'flow' }, withTempState);
    const rows = (component as unknown as { rows: readonly { kind: string }[] }).rows;
    const thinkingIdx = rows.findIndex((r) => r.kind === 'form_thinking');
    (component as unknown as { selectedIndex: number }).selectedIndex = thinkingIdx;
    component.handleInput(RIGHT);
    expect(strip(component.render(120).join('\n'))).toContain('[ Low ]');
    component.handleInput(LEFT);
    component.handleInput(LEFT);
    expect(strip(component.render(120).join('\n'))).toContain('[ Xhigh ]');

    const providerIdx = rows.findIndex((r) => r.kind === 'provider');
    (component as unknown as { selectedIndex: number }).selectedIndex = providerIdx;
    component.handleInput(RIGHT);
    expect(strip(component.render(120).join('\n'))).toContain('← Default →');
    component.handleInput(RIGHT);
    expect(strip(component.render(120).join('\n'))).toContain('← Low →');

    clickCustomStart(component);
    expect(onStart).toHaveBeenCalledWith(
      expect.objectContaining({
        pattern: 'flow',
        formOptions: expect.objectContaining({
          thinkingEffort: 'xhigh',
        }),
      }),
    );
  });

  it('uses DESIGN.md header, SELECT_POINTER, and visible Start/Cancel', () => {
    const { component, onCancel } = makeCustom({ initialPattern: 'moa' }, withTempState);
    const lines = component.render(120).map(strip);
    expect(lines[0]).toMatch(/^─+$/);
    expect(lines[1]).toContain('Custom Multi-Model Agent Swarm');
    expect(lines[2]).toContain('↑↓ navigate');
    expect(lines[2]).toContain('←→ effort');
    expect(lines[2]).toContain('Enter select/start');
    expect(lines[2]).toContain('Esc cancel');
    expect(lines[3]).toBe('');
    expect(lines.at(-1)).toMatch(/^─+$/);
    expect(lines.join('\n')).toContain('❯');
    expect(lines.join('\n')).toContain('[ Start Custom Swarm ]');
    expect(lines.join('\n')).toContain('[ Cancel ]');
    expect(lines.join('\n')).not.toMatch(/Native Fusion team/);

    component.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
