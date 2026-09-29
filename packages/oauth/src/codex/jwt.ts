import { isRecord } from '../utils';

const AUTH_CLAIM = 'https://api.openai.com/auth';
const PROFILE_CLAIM = 'https://api.openai.com/profile';

export interface CodexJwtClaims {
  readonly email?: string;
  readonly exp?: number;
  readonly accountId?: string;
  readonly chatgptUserId?: string;
  readonly planType?: string;
  readonly accountIsFedramp: boolean;
}

export function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] === '' || parts[1] === '' || parts[2] === '') {
    return undefined;
  }
  try {
    const padded = padBase64Url(parts[1] ?? '');
    const json = Buffer.from(padded, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function readCodexJwtClaims(idToken: string): CodexJwtClaims {
  const claims = decodeJwtPayload(idToken) ?? {};
  const auth = isRecord(claims[AUTH_CLAIM]) ? claims[AUTH_CLAIM] : undefined;
  const profile = isRecord(claims[PROFILE_CLAIM]) ? claims[PROFILE_CLAIM] : undefined;
  const email =
    readString(claims['email']) ?? (profile === undefined ? undefined : readString(profile['email']));
  const exp = typeof claims['exp'] === 'number' ? claims['exp'] : undefined;
  return {
    email,
    exp,
    accountId: auth === undefined ? undefined : readString(auth['chatgpt_account_id']),
    chatgptUserId:
      auth === undefined
        ? undefined
        : (readString(auth['chatgpt_user_id']) ?? readString(auth['user_id'])),
    planType: auth === undefined ? undefined : readString(auth['chatgpt_plan_type']),
    accountIsFedramp: auth !== undefined && auth['chatgpt_account_is_fedramp'] === true,
  };
}

export function jwtExpirationUnix(token: string): number | undefined {
  const claims = decodeJwtPayload(token);
  return typeof claims?.['exp'] === 'number' ? claims['exp'] : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function padBase64Url(value: string): string {
  const pad = (4 - (value.length % 4)) % 4;
  return value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat(pad);
}
