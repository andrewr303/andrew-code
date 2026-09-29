import { homedir } from 'node:os';
import { join } from 'node:path';

export const ANDREWCODE_HOME_ENV = 'ANDREWCODE_HOME';
export const KIMI_CODE_HOME_ENV = 'KIMI_CODE_HOME';
export const ANDREWCODE_HOME_DIR_NAME = '.andrewcode';

/**
 * Isolated AndrewCode home. Never falls back to `~/.kimi-code`.
 * `KIMI_CODE_HOME` is honored only when set explicitly (tests / migration).
 */
export function resolveAndrewHome(override?: string): string {
  if (override !== undefined && override.trim().length > 0) return override;
  const andrew = process.env[ANDREWCODE_HOME_ENV];
  if (andrew !== undefined && andrew.trim().length > 0) return andrew;
  const legacy = process.env[KIMI_CODE_HOME_ENV];
  if (legacy !== undefined && legacy.trim().length > 0) return legacy;
  return join(homedir(), ANDREWCODE_HOME_DIR_NAME);
}
