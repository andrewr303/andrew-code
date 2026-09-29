/**
 * Scenario: hashline anchors — Read tags, HashEdit validates and applies, stale refs reject.
 * Responsibilities: verify hash computation, anchor validation, edit ops, and mismatch recovery.
 * Wiring: real hash functions + HashEdit tool with stubbed fs/env/workspace.
 * Run: `pnpm --filter @moonshot-ai/agent-core-v2 exec vitest run test/features/hashline.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { IHostEnvironment } from '#/os/interface/hostEnvironment';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import { stubWorkspaceContext } from '../session/workspaceContext/stub-workspace-context';
import { outputText } from './helpers';
import {
  computeLineHash,
  formatHashLine,
  parseLineRef,
  validateLineRefs,
} from '#/features/hashline/hash';
import { HashEditTool } from '#/features/hashline/tools/hash-edit/hashEditTool';
import type { ExecutableToolContext, ToolExecution } from '#/tool/toolContract';

const signal = new AbortController().signal;
const PERMISSIVE_WORKSPACE = stubWorkspaceContext('/');

let disposables: DisposableStore;

function createTestEnv(home = '/home'): IHostEnvironment {
  return {
    _serviceBrand: undefined,
    osKind: 'Linux',
    osArch: 'x86_64',
    osVersion: 'test',
    shellName: 'bash',
    shellPath: '/bin/bash',
    pathClass: 'posix',
    homeDir: home,
    ready: Promise.resolve(),
  };
}

function buildTool(fs: IHostFileSystem): HashEditTool {
  return new HashEditTool(fs, createTestEnv(), PERMISSIVE_WORKSPACE);
}

async function run(tool: HashEditTool, args: unknown): Promise<ToolExecution> {
  return tool.resolveExecution(args as never);
}

async function execute(execution: ToolExecution) {
  if (!('execute' in execution)) throw new Error('not runnable');
  return execution.execute({ turnId: 1, toolCallId: 'c1', signal } satisfies ExecutableToolContext);
}

describe('hashline — hash-anchored edits (src/features/hashline)', () => {
  beforeEach(() => {
    disposables = new DisposableStore();
  });
  afterEach(() => disposables.dispose());

  describe('pure hash functions', () => {
    it('renders and parses round-trip', () => {
      const rendered = formatHashLine(3, '  return "world";');
      expect(rendered).toMatch(/^3#[ZPMQVRWSNKTXJBYH]{2}\|  return "world";$/);
      expect(parseLineRef(rendered.split('|', 1)[0]!)).toEqual({
        line: 3,
        hash: computeLineHash(3, '  return "world";'),
      });
    });

    it('distinguishes identical content at different blank-line positions', () => {
      const hash1 = computeLineHash(1, '');
      const hash5 = computeLineHash(5, '');
      expect(hash1).not.toBe(hash5);
    });

    it('normalizes CRLF like Read does', () => {
      expect(computeLineHash(2, 'foo\r')).toBe(computeLineHash(2, 'foo'));
    });
  });

  describe('HashEdit tool', () => {
    it('applies a replace anchored on a valid tag', async () => {
      let content = 'alpha\nbeta\ngamma\n';
      const fs = {
        readText: vi.fn(async () => content),
        writeText: vi.fn(async (_path: string, data: string) => {
          content = data;
        }),
        stat: vi.fn(async () => ({ isFile: true, isDirectory: false, size: 0 })),
      } as unknown as IHostFileSystem;
      const tool = buildTool(fs);
      const ref = `2#${computeLineHash(2, 'beta')}`;
      const result = await execute(await run(tool, { path: '/tmp/f.txt', op: 'replace', pos: ref, lines: ['BETA'] }));
      expect(result.isError).not.toBe(true);
      expect(content).toBe('alpha\nBETA\ngamma\n');
    });

    it('rejects a stale tag with fresh refs in the message', async () => {
      const writeText = vi.fn(async () => undefined);
      const fs = {
        readText: vi.fn(async () => 'alpha\nchanged!\ngamma\n'),
        writeText,
        stat: vi.fn(async () => ({ isFile: true, isDirectory: false, size: 0 })),
      } as unknown as IHostFileSystem;
      const tool = buildTool(fs);
      const staleRef = `2#${computeLineHash(2, 'beta')}`;
      const result = await execute(
        await run(tool, { path: '/tmp/f.txt', op: 'replace', pos: staleRef, lines: ['X'] }),
      );
      expect(result.isError).toBe(true);
      const output = outputText(result);
      expect(output).toContain('changed since last read');
      expect(output).toContain('>>>');
      expect(output).toContain(`2#${computeLineHash(2, 'changed!')}`);
      expect(writeText).not.toHaveBeenCalled();
    });

    it('appends at EOF without an anchor and prepends at BOF', async () => {
      let content = 'one\ntwo\n';
      const fs = {
        readText: vi.fn(async () => content),
        writeText: vi.fn(async (_path: string, data: string) => {
          content = data;
        }),
        stat: vi.fn(async () => ({ isFile: true, isDirectory: false, size: 0 })),
      } as unknown as IHostFileSystem;
      const tool = buildTool(fs);
      await execute(await run(tool, { path: '/tmp/f.txt', op: 'append', lines: ['three'] }));
      expect(content).toBe('one\ntwo\nthree\n');
      await execute(await run(tool, { path: '/tmp/f.txt', op: 'prepend', lines: ['zero'] }));
      expect(content).toBe('zero\none\ntwo\nthree\n');
    });

    it('validates a range replace end-to-end', async () => {
      let content = 'a\nb\nc\nd\ne\n';
      const fs = {
        readText: vi.fn(async () => content),
        writeText: vi.fn(async (_path: string, data: string) => {
          content = data;
        }),
        stat: vi.fn(async () => ({ isFile: true, isDirectory: false, size: 0 })),
      } as unknown as IHostFileSystem;
      const tool = buildTool(fs);
      const result = await execute(
        await run(tool, {
          path: '/tmp/f.txt',
          op: 'replace',
          pos: `2#${computeLineHash(2, 'b')}`,
          end: `4#${computeLineHash(4, 'd')}`,
          lines: ['X', 'Y'],
        }),
      );
      expect(result.isError).not.toBe(true);
      expect(content).toBe('a\nX\nY\ne\n');
    });
  });

  it('validateLineRefs throws HashlineMismatch on drift', () => {
    const lines = ['x', 'y'];
    const stale = `1#${computeLineHash(1, 'different')}`;
    expect(() => validateLineRefs(lines, [stale])).toThrowError(/changed since last read/);
  });
});
