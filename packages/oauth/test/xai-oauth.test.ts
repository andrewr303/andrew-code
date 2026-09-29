import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  applyXaiOAuthConfig,
  isXaiOAuthApiBaseUrl,
  loadXaiOAuthCredentials,
  loginXai,
  refreshXaiCredentials,
  wrapFetchWithXaiOAuthHeaders,
  type ManagedKimiConfigShape,
  XAI_OAUTH_API_BASE_URL,
  XAI_OAUTH_CLIENT_ID,
  XAI_OAUTH_CLIENT_IDENTIFIER,
  XAI_OAUTH_CLIENT_VERSION,
  XAI_OAUTH_SCOPES,
  xaiOAuthRequestHeaders,
} from '../src';

const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('xAI Grok OAuth', () => {
  it('completes the Grok device flow, persists renewable credentials, and configures the proxy', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-grok-oauth-'));
    tempDirs.push(homeDir);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            device_code: 'device-code',
            user_code: 'ABCD-EFGH',
            verification_uri: 'https://accounts.x.ai/device',
            verification_uri_complete: 'https://accounts.x.ai/device?code=ABCD-EFGH',
            expires_in: 600,
            interval: 1,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            access_token: 'access-token',
            refresh_token: 'refresh-token',
            expires_in: 3600,
          }),
          { status: 200 },
        ),
      );
    const onProgress = vi.fn();

    const credentials = await loginXai({
      homeDir,
      issuer: 'https://issuer.example.test',
      fetchImpl,
      sleepImpl: async () => {},
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledWith({
      authorizationUrl: 'https://accounts.x.ai/device?code=ABCD-EFGH',
      userCode: 'ABCD-EFGH',
    });
    const deviceBody = new URLSearchParams(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(deviceBody.get('client_id')).toBe(XAI_OAUTH_CLIENT_ID);
    expect(deviceBody.get('scope')).toBe(XAI_OAUTH_SCOPES.join(' '));
    expect(credentials.refreshToken).toBe('refresh-token');
    expect(loadXaiOAuthCredentials(homeDir)?.accessToken).toBe('access-token');
    expect(xaiOAuthRequestHeaders(credentials)).toEqual({
      Authorization: 'Bearer access-token',
      'X-XAI-Token-Auth': 'xai-grok-cli',
      'x-grok-client-version': XAI_OAUTH_CLIENT_VERSION,
      'x-grok-client-identifier': XAI_OAUTH_CLIENT_IDENTIFIER,
    });

    const config: ManagedKimiConfigShape = { providers: {}, models: {} };
    applyXaiOAuthConfig(config);
    expect(config.providers['xai']).toMatchObject({
      type: 'openai',
      baseUrl: XAI_OAUTH_API_BASE_URL,
      oauth: { storage: 'file', key: 'xai' },
      customHeaders: {
        'X-XAI-Token-Auth': 'xai-grok-cli',
        'x-grok-client-version': XAI_OAUTH_CLIENT_VERSION,
        'x-grok-client-identifier': XAI_OAUTH_CLIENT_IDENTIFIER,
      },
    });
  });

  it('refreshes an expired token and preserves a rotated refresh token', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'andrewcode-grok-refresh-'));
    tempDirs.push(homeDir);
    await loginXai({
      homeDir,
      issuer: 'https://issuer.example.test',
      sleepImpl: async () => {},
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              device_code: 'device-code',
              user_code: 'ABCD-EFGH',
              verification_uri: 'https://accounts.x.ai/device',
              expires_in: 600,
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'old-access',
              refresh_token: 'old-refresh',
              expires_in: 1,
            }),
            { status: 200 },
          ),
        ),
    });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
        { status: 200 },
      ),
    );

    const refreshed = await refreshXaiCredentials({
      homeDir,
      force: true,
      issuer: 'https://issuer.example.test',
      fetchImpl,
    });

    expect(refreshed).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
    });
    const refreshBody = new URLSearchParams(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(refreshBody.get('grant_type')).toBe('refresh_token');
    expect(refreshBody.get('refresh_token')).toBe('old-refresh');
  });

  it('wraps fetch so the Grok proxy always receives a client version', async () => {
    expect(isXaiOAuthApiBaseUrl(XAI_OAUTH_API_BASE_URL)).toBe(true);
    expect(isXaiOAuthApiBaseUrl('https://api.x.ai/v1')).toBe(false);

    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('ok', { status: 200 }));
    await wrapFetchWithXaiOAuthHeaders(fetchImpl)('https://cli-chat-proxy.grok.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer access-token' },
    });

    const headers = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer access-token');
    expect(headers.get('x-grok-client-version')).toBe(XAI_OAUTH_CLIENT_VERSION);
    expect(headers.get('x-grok-client-identifier')).toBe(XAI_OAUTH_CLIENT_IDENTIFIER);
    expect(headers.get('x-xai-token-auth')).toBe('xai-grok-cli');
  });
});
