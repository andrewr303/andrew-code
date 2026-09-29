/**
 * Comms store layout under `{workspace}/.andrewcode/comms/`.
 *
 * Override with `ANDREWCODE_COMMS_DIR`. Exclusive writers use a mkdir lock;
 * JSON files are replaced via write-tmp-rename. No sqlite.
 */

import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { ANDREWCODE_DATA_DIR_NAME } from '#/constant/app';

import { CommsError, isRecord } from './types';

export const ANDREWCODE_COMMS_DIR_ENV = 'ANDREWCODE_COMMS_DIR';
export const COMMS_DIR_NAME = 'comms';
export const COMMS_BOARD_FILE = 'board.jsonl';
export const COMMS_AGENTS_FILE = 'agents.json';
export const COMMS_MAILBOX_DIR = 'mailbox';
export const COMMS_CONTEXT_FILE = 'context.json';
export const COMMS_EVENTS_FILE = 'events.jsonl';
export const COMMS_LOCK_DIR = '.lock';

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_POLL_MS = 20;

export interface CommsPaths {
  readonly dir: string;
  readonly board: string;
  readonly agents: string;
  readonly mailbox: string;
  readonly context: string;
  readonly events: string;
  readonly lock: string;
}

export function resolveCommsDir(cwd: string): string {
  const override = process.env[ANDREWCODE_COMMS_DIR_ENV];
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim();
  }
  return join(cwd, ANDREWCODE_DATA_DIR_NAME, COMMS_DIR_NAME);
}

export function commsPaths(dir: string): CommsPaths {
  return {
    dir,
    board: join(dir, COMMS_BOARD_FILE),
    agents: join(dir, COMMS_AGENTS_FILE),
    mailbox: join(dir, COMMS_MAILBOX_DIR),
    context: join(dir, COMMS_CONTEXT_FILE),
    events: join(dir, COMMS_EVENTS_FILE),
    lock: join(dir, COMMS_LOCK_DIR),
  };
}

export function commsDirExists(dir: string): boolean {
  return existsSync(join(dir, COMMS_BOARD_FILE)) || existsSync(join(dir, COMMS_AGENTS_FILE));
}

export function ensureCommsLayout(dir: string): CommsPaths {
  const paths = commsPaths(dir);
  mkdirSync(paths.dir, { recursive: true });
  mkdirSync(paths.mailbox, { recursive: true });
  if (!existsSync(paths.board)) writeFileSync(paths.board, '', 'utf8');
  if (!existsSync(paths.events)) writeFileSync(paths.events, '', 'utf8');
  if (!existsSync(paths.agents)) writeJsonAtomic(paths.agents, []);
  if (!existsSync(paths.context)) writeJsonAtomic(paths.context, {});
  return paths;
}

export function withCommsLock<T>(dir: string, work: () => T): T {
  mkdirSync(dir, { recursive: true });
  const lockDir = join(dir, COMMS_LOCK_DIR);
  acquireLock(lockDir);
  try {
    return work();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

export function readJsonlFile<T>(
  filePath: string,
  parse: (value: unknown) => T | undefined,
): T[] {
  if (!existsSync(filePath)) return [];
  const text = readFileSync(filePath, 'utf8');
  if (text.length === 0) return [];
  const out: T[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const item = parse(parsed);
      if (item !== undefined) out.push(item);
    } catch {
      continue;
    }
  }
  return out;
}

export function appendJsonlFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, '', { flag: 'a', encoding: 'utf8' });
  appendFileSync(filePath, `${JSON.stringify(value)}\n`, 'utf8');
}

export function writeJsonlFile(filePath: string, values: readonly unknown[]): void {
  const body = values.map((value) => JSON.stringify(value)).join('\n');
  writeTextAtomic(filePath, body.length === 0 ? '' : `${body}\n`);
}

export function readJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

export function writeJsonAtomic(filePath: string, value: unknown): void {
  writeTextAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeTextAtomic(filePath: string, contents: string): void {
  const tmp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  replaceFile(tmp, filePath);
}

export function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error['code'] === code;
}

function acquireLock(lockDir: string): void {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    try {
      mkdirSync(lockDir);
      writeFileSync(join(lockDir, 'owner'), `${process.pid}\n`, 'utf8');
      return;
    } catch (error) {
      if (!isErrno(error, 'EEXIST')) throw error;
      if (isStaleLock(lockDir)) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new CommsError(`comms lock timeout: ${lockDir}`);
      }
      sleepMs(LOCK_POLL_MS);
    }
  }
}

function isStaleLock(lockDir: string): boolean {
  try {
    const stat = statSync(lockDir);
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
  } catch {
    return true;
  }
}

function replaceFile(tmpPath: string, destPath: string): void {
  try {
    renameSync(tmpPath, destPath);
    return;
  } catch (error) {
    if (process.platform !== 'win32' && !isErrno(error, 'EEXIST') && !isErrno(error, 'EPERM')) {
      try {
        unlinkSync(tmpPath);
      } catch {
        // ignore cleanup failure
      }
      throw error;
    }
  }
  try {
    unlinkSync(destPath);
  } catch {
    // dest may not exist
  }
  try {
    renameSync(tmpPath, destPath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore cleanup failure
    }
    throw error;
  }
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
