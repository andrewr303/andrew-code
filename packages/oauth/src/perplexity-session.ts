import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { PerplexitySearchHit } from './perplexity';

export const PWM_TOKEN_RELATIVE_PATH = join('.config', 'perplexity-web-mcp', 'token');
export const PWM_SESSION_TOKEN_ENV = 'PERPLEXITY_SESSION_TOKEN';
export const PWM_BINARY_NAME = 'pwm';

export function pwmTokenPath(homeDir: string = homedir()): string {
  return join(homeDir, PWM_TOKEN_RELATIVE_PATH);
}

/**
 * Cheap presence check for a `pwm` session credential: the token file the
 * `pwm login` flow writes, or the `PERPLEXITY_SESSION_TOKEN` env fallback.
 * A present token may be stale — callers attempt the spawn and surface a
 * meaningful error on failure rather than treating presence as validity.
 */
export function hasPwmSession(homeDir: string = homedir()): boolean {
  const envToken = process.env[PWM_SESSION_TOKEN_ENV]?.trim();
  if (envToken !== undefined && envToken.length > 0) return true;
  try {
    return existsSync(pwmTokenPath(homeDir));
  } catch {
    return false;
  }
}

export function findPwmBinary(): string | undefined {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  try {
    const result = spawnSync(probe, [PWM_BINARY_NAME], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5_000,
    });
    if (result.status !== 0) return undefined;
    return (result.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
  } catch {
    return undefined;
  }
}

export interface PwmAskResult {
  readonly answer: string;
  readonly citations: readonly string[];
}

function parsePwmAskJson(payload: unknown): PwmAskResult {
  const record =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
  const answer = typeof record['answer'] === 'string' ? record['answer'] : '';
  // Explicit-model shape: {answer, citations: [urls]}; smart-routing shape
  // (SmartResponse.to_dict): {answer, citations, routing: {...}}.
  const rawCitations = Array.isArray(record['citations']) ? record['citations'] : [];
  const citations = rawCitations.filter((item): item is string => typeof item === 'string');
  return { answer, citations };
}

export function pwmAskOutputToHits(stdout: string): readonly PerplexitySearchHit[] {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return [];
  // `pwm ask --json` emits one JSON document: either the explicit-model shape
  // or the smart-routing `SmartResponse.to_dict()` shape.
  if (trimmed.startsWith('{')) {
    try {
      const parsed: PwmAskResult = parsePwmAskJson(JSON.parse(trimmed));
      if (parsed.answer.length === 0 && parsed.citations.length === 0) return [];
      return parsed.citations.map((url, index) => ({
        title: `Perplexity result ${String(index + 1)}`,
        url,
        snippet: parsed.answer,
      }));
    } catch {
      // Fall through to plain-text parsing below.
    }
  }
  const [answerPart, citationsPart] = trimmed.split('\n\nCitations:');
  const answer = (answerPart ?? '').trim();
  const citations: string[] = [];
  for (const line of (citationsPart ?? '').split('\n')) {
    const match = line.trim().match(/^\[\d+\]:\s*(\S+)/);
    if (match?.[1] !== undefined) citations.push(match[1]);
  }
  if (citations.length === 0) {
    return answer.length > 0 ? [{ title: answer.slice(0, 120), url: '', snippet: answer }] : [];
  }
  return citations.map((url, index) => ({
    title: `Perplexity result ${String(index + 1)}`,
    url,
    snippet: answer,
  }));
}

export interface PwmAskOptions {
  readonly query: string;
  readonly binaryPath?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export async function searchPwmSession(options: PwmAskOptions): Promise<readonly PerplexitySearchHit[]> {
  const binary = options.binaryPath ?? findPwmBinary();
  if (binary === undefined) {
    throw new Error('Perplexity session search needs the `pwm` CLI on PATH. Run `pwm login` first.');
  }
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['ask', options.query, '--json', '--intent', 'standard'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: options.timeoutMs ?? 60_000,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      reject(new Error(`Failed to run \`pwm ask\`: ${error.message}`));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = stderr.trim();
        reject(
          new Error(
            detail.length > 0
              ? `\`pwm ask\` failed (exit ${String(code)}): ${detail}`
              : `\`pwm ask\` failed with exit code ${String(code)}. Run \`pwm login --check\` to verify the session.`,
          ),
        );
        return;
      }
      try {
        resolve(pwmAskOutputToHits(stdout));
      } catch (error) {
        reject(
          new Error(
            `Could not parse \`pwm ask --json\` output: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  });
}
