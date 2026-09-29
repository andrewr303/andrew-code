import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ANDREWCODE_DATA_DIR_NAME } from '#/constant/app';
import {
  ack,
  appendEvent,
  initComms,
  listAgents,
  listBoard,
  listChannel,
  listEvents,
  pollInbox,
  postMessage,
  recordCollision,
  summarizeComms,
  upsertAgentCard,
} from '#/tui/agent-comms/store';
import {
  ANDREWCODE_COMMS_DIR_ENV,
  COMMS_AGENTS_FILE,
  COMMS_BOARD_FILE,
  COMMS_CONTEXT_FILE,
  COMMS_DIR_NAME,
  COMMS_EVENTS_FILE,
  COMMS_MAILBOX_DIR,
  commsPaths,
  resolveCommsDir,
} from '#/tui/agent-comms/paths';
import { dmChannelName } from '#/tui/agent-comms/mailbox';
import { CommsError, parseCommsMessage } from '#/tui/agent-comms/types';

const originalCommsDir = process.env[ANDREWCODE_COMMS_DIR_ENV];
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-comms-'));
  tempDirs.push(dir);
  return dir;
}

function isolateComms(): string {
  const dir = makeTempDir();
  process.env[ANDREWCODE_COMMS_DIR_ENV] = dir;
  return dir;
}

afterEach(() => {
  if (originalCommsDir === undefined) delete process.env[ANDREWCODE_COMMS_DIR_ENV];
  else process.env[ANDREWCODE_COMMS_DIR_ENV] = originalCommsDir;
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveCommsDir', () => {
  it('uses {cwd}/.andrewcode/comms when the env override is unset', () => {
    delete process.env[ANDREWCODE_COMMS_DIR_ENV];
    const cwd = makeTempDir();
    expect(resolveCommsDir(cwd)).toBe(join(cwd, ANDREWCODE_DATA_DIR_NAME, COMMS_DIR_NAME));
  });

  it('honors ANDREWCODE_COMMS_DIR over cwd', () => {
    const override = makeTempDir();
    process.env[ANDREWCODE_COMMS_DIR_ENV] = override;
    expect(resolveCommsDir(makeTempDir())).toBe(override);
  });
});

describe('initComms', () => {
  it('creates the jsonl/json layout under the resolved dir', () => {
    const dir = isolateComms();
    const paths = initComms(makeTempDir());
    expect(paths.dir).toBe(dir);
    expect(existsSync(join(dir, COMMS_BOARD_FILE))).toBe(true);
    expect(existsSync(join(dir, COMMS_AGENTS_FILE))).toBe(true);
    expect(existsSync(join(dir, COMMS_CONTEXT_FILE))).toBe(true);
    expect(existsSync(join(dir, COMMS_EVENTS_FILE))).toBe(true);
    expect(existsSync(join(dir, COMMS_MAILBOX_DIR))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, COMMS_AGENTS_FILE), 'utf8'))).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, COMMS_CONTEXT_FILE), 'utf8'))).toEqual({});
  });
});

describe('agent cards', () => {
  it('upserts and lists cards, preserving capabilities on partial update', () => {
    isolateComms();
    const cwd = makeTempDir();
    const created = upsertAgentCard(cwd, {
      id: 'arch',
      role: 'architect',
      provider: 'kimi',
      model: 'kimi-k2.6',
      capabilities: ['plan', 'review'],
      status: 'online',
    });
    expect(created).toMatchObject({
      id: 'arch',
      role: 'architect',
      provider: 'kimi',
      model: 'kimi-k2.6',
      capabilities: ['plan', 'review'],
      status: 'online',
    });
    const busy = upsertAgentCard(cwd, { id: 'arch', role: 'architect', status: 'busy' });
    expect(busy.capabilities).toEqual(['plan', 'review']);
    expect(busy.provider).toBe('kimi');
    expect(busy.status).toBe('busy');
    expect(listAgents(cwd)).toHaveLength(1);
  });

  it('rejects path-like agent ids', () => {
    isolateComms();
    expect(() =>
      upsertAgentCard(makeTempDir(), { id: '../escape', role: 'worker' }),
    ).toThrow(CommsError);
  });
});

describe('postMessage / pollInbox / ack', () => {
  it('appends to board.jsonl and fans out hive mailboxes', () => {
    isolateComms();
    const cwd = makeTempDir();
    upsertAgentCard(cwd, { id: 'ceo', role: 'architect' });
    upsertAgentCard(cwd, { id: 'worker-1', role: 'worker' });
    const posted = postMessage(cwd, {
      from: 'ceo',
      channel: 'hive',
      body: 'ship it @worker-1',
    });
    expect(posted.kind).toBe('message');
    expect(posted.mentions).toContain('worker-1');
    expect(posted.channel).toBe('hive');

    const board = listBoard(cwd);
    expect(board).toHaveLength(1);
    expect(board[0]?.id).toBe(posted.id);

    const workerInbox = pollInbox(cwd, 'worker-1');
    expect(workerInbox.map((message) => message.id)).toEqual([posted.id]);

    const acked = ack(cwd, 'worker-1', posted.id);
    expect(acked.id).toBe(posted.id);
    expect(pollInbox(cwd, 'worker-1')).toEqual([]);
    const kinds = listBoard(cwd).map((message) => message.kind);
    expect(kinds).toEqual(['message', 'ack']);
  });

  it('routes a to= DM onto dm:a:b and only the peer inbox', () => {
    isolateComms();
    const cwd = makeTempDir();
    upsertAgentCard(cwd, { id: 'alpha', role: 'captain' });
    upsertAgentCard(cwd, { id: 'beta', role: 'worker' });
    upsertAgentCard(cwd, { id: 'gamma', role: 'worker' });
    const posted = postMessage(cwd, {
      from: 'alpha',
      to: 'beta',
      body: 'private handoff',
    });
    expect(posted.channel).toBe(dmChannelName('alpha', 'beta'));
    expect(pollInbox(cwd, 'beta').map((message) => message.id)).toEqual([posted.id]);
    expect(pollInbox(cwd, 'gamma')).toEqual([]);
  });

  it('rejects empty from and unknown inbox acks', () => {
    isolateComms();
    const cwd = makeTempDir();
    expect(() => postMessage(cwd, { from: '  ', body: 'x' })).toThrow(CommsError);
    expect(() => ack(cwd, 'ghost', 'missing')).toThrow(CommsError);
  });
});

describe('listChannel / events / collisions', () => {
  it('filters board history by channel', () => {
    isolateComms();
    const cwd = makeTempDir();
    postMessage(cwd, { from: 'arch', channel: 'hive', body: 'all' });
    postMessage(cwd, { from: 'arch', channel: 'system', body: 'sys' });
    expect(listChannel(cwd, 'system').map((message) => message.body)).toEqual(['sys']);
  });

  it('records a same-file collision event', () => {
    isolateComms();
    const cwd = makeTempDir();
    const event = recordCollision(cwd, 'src/app.ts', ['ceo', 'worker']);
    expect(event.kind).toBe('collision');
    expect(event.path).toBe('src/app.ts');
    expect(event.agents).toEqual(['ceo', 'worker']);
    expect(listEvents(cwd)).toHaveLength(1);
    const extra = appendEvent(cwd, { kind: 'presence', body: 'ceo idle' });
    expect(extra.kind).toBe('presence');
  });
});

describe('summarizeComms', () => {
  it('reports empty when the store is missing', () => {
    isolateComms();
    expect(summarizeComms(makeTempDir())).toBe('comms: empty (not initialized)');
  });

  it('summarizes agents, messages, and collisions', () => {
    isolateComms();
    const cwd = makeTempDir();
    upsertAgentCard(cwd, { id: 'ceo', role: 'architect' });
    postMessage(cwd, { from: 'ceo', channel: 'hive', body: 'hello board' });
    recordCollision(cwd, 'a.ts', ['ceo']);
    const summary = summarizeComms(cwd);
    expect(summary).toContain('1 agent');
    expect(summary).toContain('1 message');
    expect(summary).toContain('1 collision');
    expect(summary).toContain('hello board');
  });
});

describe('missing store is safe', () => {
  it('returns empty lists without throwing', () => {
    isolateComms();
    const cwd = makeTempDir();
    expect(listAgents(cwd)).toEqual([]);
    expect(pollInbox(cwd, 'anyone')).toEqual([]);
    expect(listBoard(cwd)).toEqual([]);
    expect(listChannel(cwd, 'hive')).toEqual([]);
    expect(listEvents(cwd)).toEqual([]);
  });
});

describe('board.jsonl durability', () => {
  it('skips corrupt lines and still reads later envelopes', () => {
    const dir = isolateComms();
    const cwd = makeTempDir();
    initComms(cwd);
    const board = commsPaths(dir).board;
    writeFileSync(
      board,
      'not-json\n{"id":"m1","ts":"2026-01-01T00:00:00.000Z","from":"a","channel":"hive","kind":"message","body":"ok","mentions":[]}\n',
      'utf8',
    );
    const messages = listBoard(cwd);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe('m1');
    expect(parseCommsMessage({ kind: 'nope' })).toBeUndefined();
  });

  it('writes agents.json via tmp-rename without leaving a lock dir', () => {
    const dir = isolateComms();
    const cwd = makeTempDir();
    upsertAgentCard(cwd, { id: 'muse', role: 'operator', status: 'idle' });
    expect(existsSync(join(dir, '.lock'))).toBe(false);
    expect(existsSync(join(dir, COMMS_AGENTS_FILE))).toBe(true);
  });
});

describe('ANDREWCODE_COMMS_DIR isolation', () => {
  it('does not write into cwd/.andrewcode when overridden', () => {
    const override = isolateComms();
    const cwd = makeTempDir();
    initComms(cwd);
    postMessage(cwd, { from: 'human', channel: 'system', body: 'hi' });
    expect(existsSync(join(cwd, ANDREWCODE_DATA_DIR_NAME))).toBe(false);
    expect(existsSync(join(override, COMMS_BOARD_FILE))).toBe(true);
    mkdirSync(join(cwd, 'unrelated'), { recursive: true });
  });
});
