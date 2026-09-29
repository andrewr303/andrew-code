/**
 * Owner-protected `auth.json` for non-Codex auxiliary keys.
 *
 * Scopes are isolated: xAI, Kimi Platform, Kimi Code (API-key path), and
 * Perplexity never share a key field. Codex OAuth lives in `codex-auth.json`.
 */

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveAndrewHome } from './home';
import { isRecord } from './utils';

export const AUTH_FILE_NAME = 'auth.json';

export type IsolatedAuthScope = 'xai' | 'kimi' | 'kimi_code' | 'perplexity';

export interface IsolatedAuthStore {
  readonly xai?: { readonly api_key?: string };
  readonly kimi?: { readonly api_key?: string };
  readonly kimi_code?: { readonly api_key?: string };
  readonly perplexity?: { readonly api_key?: string };
}

export function isolatedAuthPath(homeDir?: string): string {
  return join(resolveAndrewHome(homeDir), AUTH_FILE_NAME);
}

export function loadIsolatedAuth(homeDir?: string): IsolatedAuthStore {
  const path = isolatedAuthPath(homeDir);
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(parsed)) return {};
    return {
      xai: readScope(parsed['xai']),
      kimi: readScope(parsed['kimi']),
      kimi_code: readScope(parsed['kimi_code']),
      perplexity: readScope(parsed['perplexity']),
    };
  } catch {
    return {};
  }
}

export function readIsolatedApiKey(scope: IsolatedAuthScope, homeDir?: string): string | undefined {
  const store = loadIsolatedAuth(homeDir);
  const key = store[scope]?.api_key?.trim();
  return key !== undefined && key.length > 0 ? key : undefined;
}

export function writeIsolatedApiKey(
  scope: IsolatedAuthScope,
  apiKey: string | undefined,
  homeDir?: string,
): void {
  const path = isolatedAuthPath(homeDir);
  const current = loadIsolatedAuth(homeDir);
  const next: Record<IsolatedAuthScope, { api_key?: string } | undefined> = {
    xai: current.xai,
    kimi: current.kimi,
    kimi_code: current.kimi_code,
    perplexity: current.perplexity,
  };
  const trimmed = apiKey?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    next[scope] = undefined;
  } else {
    next[scope] = { api_key: trimmed };
  }
  writeIsolatedAuth(path, {
    xai: next.xai,
    kimi: next.kimi,
    kimi_code: next.kimi_code,
    perplexity: next.perplexity,
  });
}

export function clearIsolatedApiKey(scope: IsolatedAuthScope, homeDir?: string): void {
  writeIsolatedApiKey(scope, undefined, homeDir);
}

function readScope(value: unknown): { api_key?: string } | undefined {
  if (!isRecord(value)) return undefined;
  const apiKey = value['api_key'];
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) return undefined;
  return { api_key: apiKey };
}

function writeIsolatedAuth(path: string, store: IsolatedAuthStore): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows may ignore mode.
  }
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
    chmodSync(dirname(path), 0o700);
  } catch {
    // best-effort
  }
  try {
    unlinkSync(tmp);
  } catch {
    // already renamed
  }
}
