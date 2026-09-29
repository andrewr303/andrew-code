export const CODEX_AUTH_FILE_NAME = 'codex-auth.json';
export const CODEX_MODELS_CACHE_FILE_NAME = 'codex_models_cache.json';
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_ORIGINATOR = 'codex_cli_rs';
export const CODEX_ISSUER = 'https://auth.openai.com';
export const CODEX_BACKEND_BASE_URL = 'https://chatgpt.com/backend-api';
export const CODEX_INFERENCE_BASE_URL = 'https://chatgpt.com/backend-api/codex';
export const CODEX_INFERENCE_BASE_URL_ENV = 'ANDREWCODE_CODEX_INFERENCE_BASE_URL';
export const CODEX_AUTH_BASE_URL_ENV = 'ANDREWCODE_CODEX_AUTH_BASE_URL';
export const CODEX_BACKEND_BASE_URL_ENV = 'ANDREWCODE_CODEX_BACKEND_BASE_URL';
export const CODEX_CLIENT_ID_ENV = 'CODEX_APP_SERVER_LOGIN_CLIENT_ID';
export const CODEX_CLIENT_VERSION_ENV = 'ANDREWCODE_CODEX_CLIENT_VERSION';
export const DEFAULT_CODEX_CLIENT_VERSION = '0.156.0';
export const CODEX_PROVIDER_NAME = 'codex';
export const CODEX_SCOPE =
  'openid profile email offline_access api.connectors.read api.connectors.invoke';
export const DEFAULT_CALLBACK_PORT = 1455;
export const FALLBACK_CALLBACK_PORT = 1457;
export const CALLBACK_TIMEOUT_MS = 10 * 60 * 1000;
export const DEVICE_TIMEOUT_MS = 15 * 60 * 1000;
export const AUTH_REQUEST_TIMEOUT_MS = 30_000;
export const REFRESH_WINDOW_SECS = 5 * 60;
export const UNKNOWN_EXPIRY_REFRESH_DAYS = 8;
export const CHATGPT_ACCOUNT_ID_HEADER = 'chatgpt-account-id';
export const OPENAI_FEDRAMP_HEADER = 'x-openai-fedramp';
export const CODEX_TURN_STATE_HEADER = 'x-codex-turn-state';
export const CODEX_BETA_FEATURES_HEADER = 'x-codex-beta-features';
export const CODEX_MODELS_CACHE_TTL_MS = 5 * 60 * 1000;
export const CODEX_MODELS_REQUEST_TIMEOUT_MS = 5_000;

export function inferenceBaseUrl(): string {
  const override = process.env[CODEX_INFERENCE_BASE_URL_ENV]?.trim();
  return override !== undefined && override.length > 0 ? override : CODEX_INFERENCE_BASE_URL;
}

export function issuerUrl(): string {
  const override = process.env[CODEX_AUTH_BASE_URL_ENV]?.trim();
  return override !== undefined && override.length > 0 ? override : CODEX_ISSUER;
}

export function backendBaseUrl(): string {
  const override = process.env[CODEX_BACKEND_BASE_URL_ENV]?.trim();
  return override !== undefined && override.length > 0 ? override : CODEX_BACKEND_BASE_URL;
}

export function clientId(): string {
  const override = process.env[CODEX_CLIENT_ID_ENV]?.trim();
  return override !== undefined && override.length > 0 ? override : CODEX_CLIENT_ID;
}

export function codexClientVersion(): string {
  const raw = process.env[CODEX_CLIENT_VERSION_ENV]?.trim();
  if (raw === undefined || raw.length === 0) return DEFAULT_CODEX_CLIENT_VERSION;
  const value = raw.startsWith('v') ? raw.slice(1) : raw;
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value);
  return match === null ? DEFAULT_CODEX_CLIENT_VERSION : `${match[1]}.${match[2]}.${match[3]}`;
}
