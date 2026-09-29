import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveAndrewHome } from './home';
import { isRecord } from './utils';

export const XAI_OAUTH_ISSUER = 'https://auth.x.ai';
export const XAI_OAUTH_CLIENT_ID = 'b1a00492-073a-47ea-816f-4c329264a828';
export const XAI_OAUTH_STORAGE_KEY = 'xai';
export const XAI_OAUTH_FILE_NAME = 'grok-auth.json';
export const XAI_OAUTH_API_BASE_URL = 'https://cli-chat-proxy.grok.com/v1';
/** cli-chat-proxy rejects missing/unparseable versions and requires >= 0.1.202. */
export const XAI_OAUTH_CLIENT_VERSION = '1.0.3';
export const XAI_OAUTH_CLIENT_IDENTIFIER = 'grok-shell';
export const XAI_OAUTH_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'grok-cli:access',
  'api:access',
  'conversations:read',
  'conversations:write',
  'workspaces:read',
  'workspaces:write',
] as const;

const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
const REFRESH_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const SLOW_DOWN_INCREMENT_MS = 5_000;

interface XaiOAuthStore {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_at?: string;
  readonly id_token?: string;
}

export interface XaiOAuthCredentials {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: string;
  readonly idToken?: string;
}

export interface XaiLoginProgress {
  readonly authorizationUrl: string;
  readonly userCode: string;
}

export interface XaiLoginOptions {
  readonly homeDir?: string;
  readonly openUrl?: (url: string) => void;
  readonly onProgress?: (progress: XaiLoginProgress) => void;
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
  readonly sleepImpl?: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly issuer?: string;
  readonly surface?: 'ui' | 'cli' | 'headless';
}

export function xaiOAuthPath(homeDir?: string): string {
  return join(resolveAndrewHome(homeDir), XAI_OAUTH_FILE_NAME);
}

export function loadXaiOAuthCredentials(homeDir?: string): XaiOAuthCredentials | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(xaiOAuthPath(homeDir), 'utf8'));
    if (!isRecord(parsed)) return undefined;
    const accessToken = readString(parsed['access_token']);
    if (accessToken === undefined) return undefined;
    return {
      accessToken,
      refreshToken: readString(parsed['refresh_token']),
      expiresAt: readString(parsed['expires_at']),
      idToken: readString(parsed['id_token']),
    };
  } catch {
    return undefined;
  }
}

export function clearXaiOAuthCredentials(homeDir?: string): boolean {
  try {
    unlinkSync(xaiOAuthPath(homeDir));
    return true;
  } catch {
    return false;
  }
}

export async function loginXai(options: XaiLoginOptions = {}): Promise<XaiOAuthCredentials> {
  const issuer = (options.issuer ?? XAI_OAUTH_ISSUER).replace(/\/+$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;
  const started = await postForm(
    `${issuer}/oauth2/device/code`,
    {
      client_id: XAI_OAUTH_CLIENT_ID,
      scope: XAI_OAUTH_SCOPES.join(' '),
      referrer: 'grok-build',
    },
    fetchImpl,
    options.signal,
    { ...xaiOAuthClientHeaders(), 'x-grok-client-surface': options.surface ?? 'cli' },
  );
  if (!started.ok || !isRecord(started.body)) {
    throw new Error(`Grok OAuth device-code request returned ${String(started.status)}.`);
  }

  const deviceCode = readString(started.body['device_code']);
  const userCode = readString(started.body['user_code']);
  const verificationUri = readString(started.body['verification_uri']);
  const verificationUriComplete = readString(started.body['verification_uri_complete']);
  if (deviceCode === undefined || userCode === undefined || verificationUri === undefined) {
    throw new Error('Grok OAuth device-code response was invalid.');
  }

  const authorizationUrl = verificationUriComplete ?? verificationUri;
  options.onProgress?.({ authorizationUrl, userCode });
  options.openUrl?.(authorizationUrl);

  const expiresIn = readPositiveNumber(started.body['expires_in']) ?? 600;
  let pollInterval = (readPositiveNumber(started.body['interval']) ?? 5) * 1000;
  const deadline = Date.now() + expiresIn * 1000;
  const sleepImpl = options.sleepImpl ?? sleep;

  while (Date.now() < deadline) {
    await sleepImpl(Math.max(pollInterval, DEFAULT_POLL_INTERVAL_MS), options.signal);
    const polled = await postForm(
      `${issuer}/oauth2/token`,
      {
        grant_type: DEVICE_GRANT_TYPE,
        device_code: deviceCode,
        client_id: XAI_OAUTH_CLIENT_ID,
      },
      fetchImpl,
      options.signal,
      { ...xaiOAuthClientHeaders(), 'x-grok-client-surface': options.surface ?? 'cli' },
    );
    if (polled.ok && isRecord(polled.body)) {
      return persistXaiTokens(polled.body, options.homeDir);
    }
    const code = isRecord(polled.body) ? readString(polled.body['error']) : undefined;
    if (code === 'authorization_pending') continue;
    if (code === 'slow_down') {
      pollInterval += SLOW_DOWN_INCREMENT_MS;
      continue;
    }
    if (code === 'access_denied') throw new Error('Grok OAuth authorization was denied.');
    if (code === 'expired_token') break;
    throw new Error(
      `Grok OAuth token exchange returned ${String(polled.status)}${code !== undefined ? ` (${code})` : ''}.`,
    );
  }
  throw new Error('Grok OAuth device code expired. Run `andrewcode login xai` again.');
}

export async function refreshXaiCredentials(options?: {
  readonly homeDir?: string;
  readonly force?: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly issuer?: string;
}): Promise<XaiOAuthCredentials | undefined> {
  const current = loadXaiOAuthCredentials(options?.homeDir);
  if (current === undefined) return undefined;
  if (options?.force !== true && credentialsAreFresh(current)) return current;
  if (current.refreshToken === undefined) {
    throw new Error('Grok OAuth refresh token is missing; run `andrewcode login xai`.');
  }
  const issuer = (options?.issuer ?? XAI_OAUTH_ISSUER).replace(/\/+$/, '');
  const response = await postForm(
    `${issuer}/oauth2/token`,
    {
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: XAI_OAUTH_CLIENT_ID,
    },
    options?.fetchImpl ?? fetch,
    undefined,
    xaiOAuthClientHeaders(),
  );
  if (!response.ok || !isRecord(response.body)) {
    const code = isRecord(response.body) ? readString(response.body['error']) : undefined;
    throw new Error(
      `Grok OAuth refresh returned ${String(response.status)}${code !== undefined ? ` (${code})` : ''}.`,
    );
  }
  return persistXaiTokens(
    {
      ...response.body,
      refresh_token: readString(response.body['refresh_token']) ?? current.refreshToken,
      id_token: readString(response.body['id_token']) ?? current.idToken,
    },
    options?.homeDir,
  );
}

export function xaiOAuthClientHeaders(): Record<string, string> {
  return {
    'X-XAI-Token-Auth': 'xai-grok-cli',
    'x-grok-client-version': XAI_OAUTH_CLIENT_VERSION,
    'x-grok-client-identifier': XAI_OAUTH_CLIENT_IDENTIFIER,
  };
}

export function isXaiOAuthApiBaseUrl(baseUrl: string | undefined): boolean {
  if (baseUrl === undefined || baseUrl.trim().length === 0) return false;
  try {
    return new URL(baseUrl, 'https://cli-chat-proxy.grok.com').hostname === 'cli-chat-proxy.grok.com';
  } catch {
    return baseUrl.includes('cli-chat-proxy.grok.com');
  }
}

export function wrapFetchWithXaiOAuthHeaders(fetchImpl: typeof fetch = fetch): typeof fetch {
  const required = xaiOAuthClientHeaders();
  return (input, init) => {
    const headers = new Headers(init?.headers);
    for (const [key, value] of Object.entries(required)) {
      if (!headers.has(key)) headers.set(key, value);
    }
    return fetchImpl(input, { ...init, headers });
  };
}

export function xaiOAuthRequestHeaders(
  credentials: XaiOAuthCredentials,
): Record<string, string> {
  return {
    Authorization: `Bearer ${credentials.accessToken}`,
    ...xaiOAuthClientHeaders(),
  };
}

function persistXaiTokens(body: Record<string, unknown>, homeDir?: string): XaiOAuthCredentials {
  const accessToken = readString(body['access_token']);
  if (accessToken === undefined) throw new Error('Grok OAuth token response was invalid.');
  const expiresIn = readPositiveNumber(body['expires_in']);
  const store: XaiOAuthStore = {
    access_token: accessToken,
    refresh_token: readString(body['refresh_token']),
    expires_at:
      expiresIn === undefined ? undefined : new Date(Date.now() + expiresIn * 1000).toISOString(),
    id_token: readString(body['id_token']),
  };
  const path = xaiOAuthPath(homeDir);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows
  }
  renameSync(tmp, path);
  return {
    accessToken: store.access_token,
    refreshToken: store.refresh_token,
    expiresAt: store.expires_at,
    idToken: store.id_token,
  };
}

function credentialsAreFresh(credentials: XaiOAuthCredentials): boolean {
  if (credentials.expiresAt === undefined) return false;
  const expiresAt = Date.parse(credentials.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > Date.now() + REFRESH_WINDOW_MS;
}

async function postForm(
  url: string,
  values: Record<string, string>,
  fetchImpl: typeof fetch,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown }> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(values).toString(),
    signal,
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    // Preserve a non-JSON response for the status-based error.
  }
  return { ok: response.ok, status: response.status, body };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readPositiveNumber(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('Grok OAuth login cancelled.'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Grok OAuth login cancelled.'));
      },
      { once: true },
    );
  });
}
