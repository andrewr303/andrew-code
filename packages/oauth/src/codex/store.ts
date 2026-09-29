import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveAndrewHome } from '../home';
import { isRecord } from '../utils';
import {
  CODEX_AUTH_FILE_NAME,
  CODEX_ORIGINATOR,
  codexClientVersion,
} from './constants';
import { readCodexJwtClaims } from './jwt';

export interface CodexTokenData {
  readonly id_token: string;
  readonly access_token: string;
  readonly refresh_token: string;
  readonly account_id?: string;
}

export interface CodexAuthStore {
  readonly auth_mode?: string;
  readonly OPENAI_API_KEY?: string;
  readonly tokens?: CodexTokenData;
  readonly last_refresh?: string;
}

export interface CodexCredentials {
  readonly accessToken: string;
  readonly accountId?: string;
  readonly chatgptUserId?: string;
  readonly email?: string;
  readonly planType?: string;
  readonly isWorkspaceAccount: boolean;
  readonly accountIsFedramp: boolean;
  readonly idToken: string;
  readonly refreshToken: string;
}

export function codexAuthPath(homeDir?: string): string {
  return join(resolveAndrewHome(homeDir), CODEX_AUTH_FILE_NAME);
}

export function loadCodexStore(homeDir?: string): CodexAuthStore | undefined {
  return loadCodexStoreAt(codexAuthPath(homeDir));
}

export function loadCodexStoreAt(path: string): CodexAuthStore | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(parsed)) return undefined;
    return parseStore(parsed);
  } catch {
    return undefined;
  }
}

export function loadCodexCredentials(homeDir?: string): CodexCredentials | undefined {
  const store = loadCodexStore(homeDir);
  const tokens = store?.tokens;
  if (tokens === undefined || tokens.access_token.trim().length === 0) return undefined;
  return credentialsFromTokens(tokens);
}

export function saveCodexStore(store: CodexAuthStore, homeDir?: string): void {
  saveCodexStoreAt(codexAuthPath(homeDir), store);
}

export function saveCodexStoreAt(path: string, store: CodexAuthStore): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    // Windows
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

export function clearCodexStore(homeDir?: string): boolean {
  const path = codexAuthPath(homeDir);
  try {
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

export function persistTokenResponse(
  tokens: CodexTokenData,
  homeDir?: string,
): CodexCredentials {
  const claims = readCodexJwtClaims(tokens.id_token);
  const merged: CodexTokenData = {
    ...tokens,
    account_id: tokens.account_id ?? claims.accountId,
  };
  saveCodexStore(
    {
      auth_mode: 'chatgpt',
      tokens: merged,
      last_refresh: new Date().toISOString(),
    },
    homeDir,
  );
  return credentialsFromTokens(merged);
}

export function credentialsFromTokens(tokens: CodexTokenData): CodexCredentials {
  const claims = readCodexJwtClaims(tokens.id_token);
  const planType = claims.planType;
  return {
    accessToken: tokens.access_token,
    accountId: tokens.account_id ?? claims.accountId,
    chatgptUserId: claims.chatgptUserId,
    email: claims.email,
    planType,
    isWorkspaceAccount: isWorkspacePlan(planType),
    accountIsFedramp: claims.accountIsFedramp,
    idToken: tokens.id_token,
    refreshToken: tokens.refresh_token,
  };
}

export function requestAuthHeaders(credentials: CodexCredentials): Record<string, string> {
  const version = codexClientVersion();
  const headers: Record<string, string> = {
    Authorization: `Bearer ${credentials.accessToken}`,
    originator: CODEX_ORIGINATOR,
    version,
    'user-agent': `${CODEX_ORIGINATOR}/${version}`,
  };
  if (credentials.accountId !== undefined) {
    headers['chatgpt-account-id'] = credentials.accountId;
  }
  if (credentials.accountIsFedramp) {
    headers['x-openai-fedramp'] = 'true';
  }
  return headers;
}

function isWorkspacePlan(planType: string | undefined): boolean {
  if (planType === undefined) return false;
  switch (planType.toLowerCase()) {
    case 'team':
    case 'self_serve_business_usage_based':
    case 'business':
    case 'enterprise_cbp_usage_based':
    case 'enterprise':
    case 'hc':
    case 'education':
    case 'edu':
      return true;
    default:
      return false;
  }
}

function parseStore(parsed: Record<string, unknown>): CodexAuthStore {
  const tokensRaw = parsed['tokens'];
  let tokens: CodexTokenData | undefined;
  if (isRecord(tokensRaw)) {
    const idToken = tokensRaw['id_token'];
    const accessToken = tokensRaw['access_token'];
    const refreshToken = tokensRaw['refresh_token'];
    const accountId = tokensRaw['account_id'];
    if (
      typeof idToken === 'string' &&
      typeof accessToken === 'string' &&
      typeof refreshToken === 'string'
    ) {
      tokens = {
        id_token: idToken,
        access_token: accessToken,
        refresh_token: refreshToken,
        account_id: typeof accountId === 'string' ? accountId : undefined,
      };
    }
  }
  return {
    auth_mode: typeof parsed['auth_mode'] === 'string' ? parsed['auth_mode'] : undefined,
    OPENAI_API_KEY:
      typeof parsed['OPENAI_API_KEY'] === 'string' ? parsed['OPENAI_API_KEY'] : undefined,
    tokens,
    last_refresh: typeof parsed['last_refresh'] === 'string' ? parsed['last_refresh'] : undefined,
  };
}
