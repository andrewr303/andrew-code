import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { resolveAndrewHome } from './home';
import { isRecord } from './utils';

export const ANTHROPIC_PROVIDER_NAME = 'anthropic';
export const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const CLAUDE_OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';

export interface AnthropicOAuthCredentials {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly expiresAt?: number;
}

export function loadAnthropicOAuthCredentials(homeDir?: string): AnthropicOAuthCredentials | undefined {
  // 1. Try ~/.claude/.credentials.json first (Claude Code official store)
  const claudeConfigDir = process.env['CLAUDE_CONFIG_DIR'] || join(homedir(), '.claude');
  const claudeCredsPath = join(claudeConfigDir, '.credentials.json');
  if (existsSync(claudeCredsPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(claudeCredsPath, 'utf8'));
      if (isRecord(parsed) && isRecord(parsed['claudeAiOauth'])) {
        const oauth = parsed['claudeAiOauth'];
        const accessToken = typeof oauth['accessToken'] === 'string' ? oauth['accessToken'].trim() : '';
        if (accessToken.length > 0) {
          const refreshToken = typeof oauth['refreshToken'] === 'string' ? oauth['refreshToken'].trim() : undefined;
          const expiresAt = typeof oauth['expiresAt'] === 'number' ? oauth['expiresAt'] : undefined;
          return { accessToken, refreshToken, expiresAt };
        }
      }
    } catch {
      // ignore
    }
  }

  // 2. Try ~/.andrewcode/credentials/anthropic.json
  const andrewHome = resolveAndrewHome(homeDir);
  const credsPath = join(andrewHome, 'credentials', 'anthropic.json');
  if (existsSync(credsPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(credsPath, 'utf8'));
      if (isRecord(parsed)) {
        const accessToken = typeof parsed['access_token'] === 'string' ? parsed['access_token'].trim() : '';
        if (accessToken.length > 0) {
          const refreshToken = typeof parsed['refresh_token'] === 'string' ? parsed['refresh_token'].trim() : undefined;
          const expiresAt = typeof parsed['expires_at'] === 'number' ? parsed['expires_at'] * 1000 : undefined;
          return { accessToken, refreshToken, expiresAt };
        }
      }
    } catch {
      // ignore
    }
  }

  return undefined;
}

export async function refreshAnthropicCredentials(options?: {
  readonly homeDir?: string;
  readonly force?: boolean;
}): Promise<AnthropicOAuthCredentials | undefined> {
  const current = loadAnthropicOAuthCredentials(options?.homeDir);
  if (current === undefined) return undefined;
  if (options?.force !== true && current.expiresAt !== undefined && current.expiresAt > Date.now() + 60_000) {
    return current;
  }
  return current;
}
