import { backendBaseUrl } from './constants';
import { requestAuthHeaders, type CodexCredentials } from './store';
import { isRecord } from '../utils';

export interface CodexUsageWindow {
  readonly usedPercent: number;
  readonly limitWindowSeconds?: number;
  readonly resetAfterSeconds?: number;
}

export interface CodexUsageSnapshot {
  readonly planType?: string;
  readonly email?: string;
  readonly primary?: CodexUsageWindow;
  readonly secondary?: CodexUsageWindow;
  readonly fetchedAt: string;
}

export async function fetchCodexUsage(options: {
  readonly credentials: CodexCredentials;
  readonly fetchImpl?: typeof fetch;
}): Promise<CodexUsageSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = backendBaseUrl().replace(/\/+$/, '');
  const headers = requestAuthHeaders(options.credentials);
  const response = await fetchImpl(`${base}/wham/usage`, { headers });
  if (!response.ok) {
    throw new Error(`Codex usage request returned ${String(response.status)}`);
  }
  const body: unknown = await response.json();
  const record = isRecord(body) ? body : {};
  const rate = isRecord(record['rate_limit']) ? record['rate_limit'] : {};
  return {
    planType: options.credentials.planType ?? readString(record['plan_type']),
    email: options.credentials.email,
    primary: readWindow(rate['primary_window']),
    secondary: readWindow(rate['secondary_window']),
    fetchedAt: new Date().toISOString(),
  };
}

function readWindow(value: unknown): CodexUsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const used = Number(value['used_percent']);
  if (!Number.isFinite(used)) return undefined;
  return {
    usedPercent: used,
    limitWindowSeconds: readNumber(value['limit_window_seconds']),
    resetAfterSeconds: readNumber(value['reset_after_seconds']),
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
