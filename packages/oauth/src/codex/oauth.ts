import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { AUTH_REQUEST_TIMEOUT_MS, CALLBACK_TIMEOUT_MS, clientId, CODEX_SCOPE, DEFAULT_CALLBACK_PORT, DEVICE_TIMEOUT_MS, FALLBACK_CALLBACK_PORT, issuerUrl } from './constants';
import { jwtExpirationUnix } from './jwt';
import {
  loadCodexStore,
  persistTokenResponse,
  type CodexAuthStore,
  type CodexCredentials,
} from './store';

export interface CodexLoginProgress {
  readonly authorizationUrl: string;
  readonly userCode?: string;
}

export interface CodexLoginOptions {
  readonly deviceAuth?: boolean;
  readonly homeDir?: string;
  readonly openUrl?: (url: string) => void;
  readonly onProgress?: (progress: CodexLoginProgress) => void;
  readonly signal?: AbortSignal;
}

export async function loginCodex(options: CodexLoginOptions = {}): Promise<CodexCredentials> {
  if (options.deviceAuth === true) {
    return runDeviceLogin(options);
  }
  return runBrowserLogin(options);
}

export async function refreshCodexCredentials(options?: {
  readonly homeDir?: string;
  readonly force?: boolean;
}): Promise<CodexCredentials | undefined> {
  const store = loadCodexStore(options?.homeDir);
  if (store?.tokens === undefined) return undefined;
  if (options?.force !== true && accessTokenIsFresh(store)) {
    return persistTokenResponse(store.tokens, options?.homeDir);
  }
  const tokens = store.tokens;
  if (tokens.refresh_token.trim().length === 0) {
    throw new Error('Codex OAuth refresh token is missing; run `andrewcode login --codex`.');
  }
  const priorAccount = tokens.account_id;
  const response = await fetchJson(`${issuerUrl().replace(/\/+$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId(),
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    }),
  });
  if (!response.ok) {
    const code = refreshErrorCode(response.body);
    const permanent =
      response.status === 401 ||
      code === 'refresh_token_expired' ||
      code === 'refresh_token_reused' ||
      code === 'refresh_token_invalidated';
    throw new Error(
      `Codex OAuth refresh returned ${String(response.status)}${code !== undefined ? ` (${code})` : ''}.${
        permanent ? ' Run `andrewcode login --codex` to reconnect.' : ''
      }`,
    );
  }
  const body = isJsonRecord(response.body) ? response.body : {};
  const idToken = readString(body['id_token']) ?? tokens.id_token;
  const accessToken = readString(body['access_token']) ?? tokens.access_token;
  const refreshToken = readString(body['refresh_token']) ?? tokens.refresh_token;
  return persistTokenResponse(
    {
      id_token: idToken,
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: priorAccount,
    },
    options?.homeDir,
  );
}

async function runBrowserLogin(options: CodexLoginOptions): Promise<CodexCredentials> {
  const { server, port } = await bindCallbackServer();
  const redirectUri = `http://localhost:${String(port)}/auth/callback`;
  const pkce = generatePkce();
  const state = generateState();
  const authorizationUrl = buildAuthorizeUrl(redirectUri, pkce.challenge, state);
  options.onProgress?.({ authorizationUrl });
  options.openUrl?.(authorizationUrl);

  try {
    const code = await waitForCallback(server, state, options.signal);
    const tokens = await exchangeCode(code, redirectUri, pkce.verifier);
    return persistTokenResponse(tokens, options.homeDir);
  } finally {
    await closeServer(server);
  }
}

async function runDeviceLogin(options: CodexLoginOptions): Promise<CodexCredentials> {
  const issuer = issuerUrl().replace(/\/+$/, '');
  const started = await fetchJson(`${issuer}/api/accounts/deviceauth/usercode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: clientId() }),
  });
  if (!started.ok || !isJsonRecord(started.body)) {
    throw new Error(`Codex device-code request returned ${String(started.status)}`);
  }
  const deviceAuthId = readString(started.body['device_auth_id']);
  const userCode =
    readString(started.body['user_code']) ?? readString(started.body['usercode']);
  if (deviceAuthId === undefined || userCode === undefined) {
    throw new Error('Codex device-code response was invalid');
  }
  const intervalRaw = started.body['interval'];
  const intervalSec = Math.max(
    1,
    typeof intervalRaw === 'number' ? intervalRaw : Number.parseInt(String(intervalRaw ?? '1'), 10) || 1,
  );
  const verificationUrl = `${issuer}/codex/device`;
  options.onProgress?.({ authorizationUrl: verificationUrl, userCode });
  options.openUrl?.(verificationUrl);

  const deadline = Date.now() + DEVICE_TIMEOUT_MS;
  let deviceBody: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    if (options.signal?.aborted === true) throw new Error('Codex device-code login cancelled');
    const poll = await fetchJson(`${issuer}/api/accounts/deviceauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
    });
    if (poll.ok && isJsonRecord(poll.body)) {
      deviceBody = poll.body;
      break;
    }
    if (poll.status !== 403 && poll.status !== 404) {
      throw new Error(`Codex device-code login returned ${String(poll.status)}`);
    }
    await sleep(intervalSec * 1000, options.signal);
  }
  if (deviceBody === undefined) {
    throw new Error('Codex device-code login timed out after 15 minutes');
  }
  const authorizationCode = readString(deviceBody['authorization_code']);
  const codeVerifier = readString(deviceBody['code_verifier']);
  const codeChallenge = readString(deviceBody['code_challenge']);
  if (authorizationCode === undefined || codeVerifier === undefined) {
    throw new Error('Codex device-code token response was invalid');
  }
  if (codeChallenge === undefined || codeChallenge.trim().length === 0) {
    throw new Error('Codex device-code response omitted its PKCE challenge');
  }
  const tokens = await exchangeCode(
    authorizationCode,
    `${issuer}/deviceauth/callback`,
    codeVerifier,
  );
  return persistTokenResponse(tokens, options.homeDir);
}

function buildAuthorizeUrl(redirectUri: string, challenge: string, state: string): string {
  const url = new URL(`${issuerUrl().replace(/\/+$/, '')}/oauth/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId());
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', CODEX_SCOPE);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('id_token_add_organizations', 'true');
  url.searchParams.set('codex_cli_simplified_flow', 'true');
  url.searchParams.set('state', state);
  url.searchParams.set('originator', 'codex_cli_rs');
  return url.toString();
}

async function exchangeCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
): Promise<{ id_token: string; access_token: string; refresh_token: string }> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId(),
    code_verifier: codeVerifier,
  });
  const response = await fetchJson(`${issuerUrl().replace(/\/+$/, '')}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!response.ok || !isJsonRecord(response.body)) {
    throw new Error(`Codex OAuth token exchange returned ${String(response.status)}`);
  }
  const idToken = readString(response.body['id_token']);
  const accessToken = readString(response.body['access_token']);
  const refreshToken = readString(response.body['refresh_token']);
  if (idToken === undefined || accessToken === undefined || refreshToken === undefined) {
    throw new Error('Codex OAuth token response was invalid');
  }
  return { id_token: idToken, access_token: accessToken, refresh_token: refreshToken };
}

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function generateState(): string {
  return randomBytes(32).toString('base64url');
}

function accessTokenIsFresh(store: CodexAuthStore): boolean {
  const tokens = store.tokens;
  if (tokens === undefined) return false;
  const exp = jwtExpirationUnix(tokens.access_token);
  if (exp !== undefined) {
    return exp > Math.floor(Date.now() / 1000) + 5 * 60;
  }
  if (store.last_refresh === undefined) return false;
  const last = Date.parse(store.last_refresh);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < 8 * 24 * 60 * 60 * 1000;
}

async function bindCallbackServer(): Promise<{
  server: ReturnType<typeof createServer>;
  port: number;
}> {
  const tryPort = async (port: number): Promise<ReturnType<typeof createServer>> =>
    new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve(server);
      });
    });
  try {
    const server = await tryPort(DEFAULT_CALLBACK_PORT);
    return { server, port: DEFAULT_CALLBACK_PORT };
  } catch {
    const server = await tryPort(FALLBACK_CALLBACK_PORT);
    return { server, port: FALLBACK_CALLBACK_PORT };
  }
}

function waitForCallback(
  server: ReturnType<typeof createServer>,
  expectedState: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timed out waiting for the Codex OAuth callback'));
    }, CALLBACK_TIMEOUT_MS);
    const onAbort = (): void => {
      cleanup();
      reject(new Error('Codex OAuth login cancelled'));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      server.removeListener('request', onRequest);
    };
    const onRequest = (req: IncomingMessage, res: ServerResponse): void => {
      const host = req.headers.host ?? 'localhost';
      const url = new URL(req.url ?? '/', `http://${host}`);
      if (url.pathname !== '/auth/callback') {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      if (url.searchParams.get('state') !== expectedState) {
        res.statusCode = 400;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(htmlPage('AndrewCode login failed', 'OpenAI Codex login failed. Return to AndrewCode.'));
        return;
      }
      const error = url.searchParams.get('error');
      if (error !== null) {
        const description = url.searchParams.get('error_description');
        res.statusCode = 400;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(htmlPage('AndrewCode login failed', 'OpenAI Codex login failed. Return to AndrewCode.'));
        cleanup();
        reject(new Error(description !== null && description.length > 0 ? `${error}: ${description}` : error));
        return;
      }
      const code = url.searchParams.get('code')?.trim();
      if (code === undefined || code.length === 0) {
        res.statusCode = 400;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(htmlPage('AndrewCode login failed', 'OpenAI Codex login failed. Return to AndrewCode.'));
        cleanup();
        reject(new Error('OAuth callback did not include a code'));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(htmlPage('AndrewCode connected', 'OpenAI Codex connected. You can close this window and return to AndrewCode.'));
      cleanup();
      resolve(code);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted === true) {
      onAbort();
      return;
    }
    server.on('request', onRequest);
  });
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><title>${title}</title><h1>${body}</h1>`;
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text.length > 0 ? JSON.parse(text) : {};
    } catch {
      body = text;
    }
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function refreshErrorCode(body: unknown): string | undefined {
  if (!isJsonRecord(body)) return undefined;
  const error = body['error'];
  return typeof error === 'string' ? error : undefined;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error('cancelled'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('cancelled'));
      },
      { once: true },
    );
  });
}
