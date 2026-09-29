import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ANDREWCODE_COMMS_DIR_ENV } from '#/tui/agent-comms/paths';
import { AgentCommsPaneComponent } from '#/tui/components/panes/agent-comms-pane';
import {
  SwarmBoardDialogComponent,
  formatCommsRelativeTime,
  loadSwarmBoardMessages,
  type SwarmBoardMessage,
} from '#/tui/components/dialogs/swarm-board-dialog';

const ANSI = /\u001B\[[0-9;]*m/g;
const ESC = String.fromCodePoint(27);
const TAB = '\t';
const SHIFT_TAB = `${ESC}[Z`;
const ENTER = '\r';
const DOWN = `${ESC}[B`;

function strip(text: string): string {
  return text.replaceAll(ANSI, '');
}

function text(component: { render(width: number): string[] }, width = 120): string {
  return component.render(width).map(strip).join('\n');
}

const originalCommsDir = process.env[ANDREWCODE_COMMS_DIR_ENV];
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'swarm-board-dialog-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalCommsDir === undefined) delete process.env[ANDREWCODE_COMMS_DIR_ENV];
  else process.env[ANDREWCODE_COMMS_DIR_ENV] = originalCommsDir;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function message(
  overrides: Partial<SwarmBoardMessage> & Pick<SwarmBoardMessage, 'id' | 'from' | 'channel' | 'body'>,
): SwarmBoardMessage {
  return {
    ts: '2026-09-22T16:00:00.000Z',
    kind: 'message',
    mentions: [],
    ...overrides,
  };
}

describe('formatCommsRelativeTime', () => {
  it('renders relative timestamps from ISO strings', () => {
    const now = Date.parse('2026-09-22T16:10:00.000Z');
    expect(formatCommsRelativeTime('2026-09-22T16:09:30.000Z', now)).toBe('just now');
    expect(formatCommsRelativeTime('2026-09-22T16:08:00.000Z', now)).toBe('2m ago');
    expect(formatCommsRelativeTime('2026-09-22T13:10:00.000Z', now)).toBe('3h ago');
  });
});

describe('SwarmBoardDialogComponent', () => {
  it('uses the model-dialog header, channel tabs, and Esc cancel', () => {
    const onCancel = vi.fn();
    const dialog = new SwarmBoardDialogComponent({
      messages: [
        message({
          id: 'm1',
          from: 'architect',
          channel: 'hive',
          body: 'Ship the retry helper.',
        }),
      ],
      onCancel,
    });

    const lines = dialog.render(120).map(strip);
    const titleIdx = lines.findIndex((line) => line.includes('Agent comms'));
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(lines[titleIdx]).toContain('(type to search)');
    expect(lines[titleIdx + 1]).toContain('Tab toggle channel');
    expect(lines[titleIdx + 1]).toContain('↑↓ navigate');
    expect(lines[titleIdx + 1]).not.toContain('Enter select');
    expect(lines[titleIdx + 1]).toContain('Esc cancel');
    expect(lines[titleIdx + 2]).toBe('');
    expect(text(dialog)).toContain('All');
    expect(text(dialog)).toContain('hive');
    expect(text(dialog)).toContain('architect');
    expect(text(dialog)).toContain('Ship the retry helper.');
    expect(text(dialog)).toContain('❯');

    dialog.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders a muted empty state when the store is missing', () => {
    const cwd = makeTempDir();
    const dialog = new SwarmBoardDialogComponent({
      cwd,
      onCancel: vi.fn(),
    });
    const out = text(dialog);
    expect(out).toContain('No agent communications yet');
    expect(out).toContain('Esc cancel');
    expect(out).not.toContain('No matches');
  });

  it('filters by channel with Tab and restores All with Shift-Tab', () => {
    const dialog = new SwarmBoardDialogComponent({
      messages: [
        message({ id: 'h1', from: 'ceo', channel: 'hive', body: 'hive brief' }),
        message({ id: 'w1', from: 'worker', channel: 'workers', body: 'worker note' }),
      ],
      onCancel: vi.fn(),
    });

    expect(text(dialog)).toContain('hive brief');
    expect(text(dialog)).toContain('worker note');

    dialog.handleInput(TAB);
    expect(text(dialog)).toContain('hive brief');
    expect(text(dialog)).not.toContain('worker note');

    // all → hive → architect → captains → workers
    for (let i = 0; i < 3; i++) dialog.handleInput(TAB);
    expect(text(dialog)).toContain('worker note');
    expect(text(dialog)).not.toContain('hive brief');
    expect(text(dialog)).not.toContain('No messages in this channel');

    dialog.handleInput(SHIFT_TAB);
    dialog.handleInput(SHIFT_TAB);
    dialog.handleInput(SHIFT_TAB);
    dialog.handleInput(SHIFT_TAB);
    expect(text(dialog)).toContain('hive brief');
    expect(text(dialog)).toContain('worker note');
  });

  it('clears the search query on first Esc and cancels on the second', () => {
    const onCancel = vi.fn();
    const dialog = new SwarmBoardDialogComponent({
      messages: [
        message({ id: 'h1', from: 'ceo', channel: 'hive', body: 'retry helper' }),
        message({ id: 'w1', from: 'muse', channel: 'workers', body: 'unrelated' }),
      ],
      onCancel,
    });

    for (const ch of 'retry') dialog.handleInput(ch);
    expect(text(dialog)).toContain('Search:');
    expect(text(dialog)).toContain('retry helper');
    expect(text(dialog)).not.toContain('unrelated');
    expect(text(dialog)).toContain('1 / 2');
    expect(text(dialog)).toContain('Backspace clear');

    dialog.handleInput(ESC);
    expect(onCancel).not.toHaveBeenCalled();
    expect(text(dialog)).not.toContain('Search:');
    expect(text(dialog)).toContain('unrelated');

    dialog.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('selects the highlighted message on Enter and pages with ←→', () => {
    const onSelect = vi.fn();
    const messages: SwarmBoardMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(
        message({
          id: `m${String(i)}`,
          from: `agent-${String(i)}`,
          channel: 'hive',
          body: `payload ${String(i)}`,
          ts: `2026-09-22T16:${String(i).padStart(2, '0')}:00.000Z`,
        }),
      );
    }
    const dialog = new SwarmBoardDialogComponent({
      messages,
      pageSize: 4,
      onSelect,
      onCancel: vi.fn(),
    });

    expect(text(dialog)).toContain('←→ page');
    expect(text(dialog)).toContain('Enter select');
    expect(text(dialog)).toContain('▼ 6 more');
    dialog.handleInput(DOWN);
    dialog.handleInput(ENTER);
    expect(onSelect).toHaveBeenCalledOnce();
    const selected = onSelect.mock.calls[0]?.[0] as SwarmBoardMessage | undefined;
    expect(selected?.from).toBe('agent-8');
  });

  it('loads board.jsonl from a comms dir without crashing on junk lines', () => {
    const dir = makeTempDir();
    writeFileSync(
      join(dir, 'board.jsonl'),
      [
        '{not json}',
        JSON.stringify({
          id: 'ok',
          ts: '2026-09-22T16:00:00.000Z',
          from: 'ceo',
          channel: 'hive',
          kind: 'message',
          body: 'from disk',
          mentions: [],
        }),
        '',
      ].join('\n'),
      'utf8',
    );
    const loaded = loadSwarmBoardMessages({ commsDir: dir });
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.body).toBe('from disk');

    const dialog = new SwarmBoardDialogComponent({
      commsDir: dir,
      onCancel: vi.fn(),
    });
    expect(text(dialog)).toContain('from disk');
  });
});

describe('AgentCommsPaneComponent', () => {
  it('renders the last N messages oldest-first', () => {
    const pane = new AgentCommsPaneComponent({
      limit: 2,
      messages: [
        message({
          id: 'old',
          from: 'ceo',
          channel: 'hive',
          body: 'first',
          ts: '2026-09-22T16:00:00.000Z',
        }),
        message({
          id: 'mid',
          from: 'coo',
          channel: 'captains',
          body: 'second',
          ts: '2026-09-22T16:01:00.000Z',
        }),
        message({
          id: 'new',
          from: 'worker',
          channel: 'workers',
          body: 'third',
          ts: '2026-09-22T16:02:00.000Z',
        }),
      ],
    });
    const out = text(pane);
    expect(out).not.toContain('first');
    expect(out).toContain('coo · captains');
    expect(out).toContain('second');
    expect(out).toContain('worker · workers');
    expect(out).toContain('third');
    expect(out).toContain('●');
  });

  it('renders a muted empty state when there is no store', () => {
    const cwd = makeTempDir();
    mkdirSync(join(cwd, 'src'), { recursive: true });
    const pane = new AgentCommsPaneComponent({ cwd });
    expect(text(pane)).toContain('no agent comms');
  });
});
