/**
 * Feature-test helper: render a tool result's `output` as text without
 * `String()`'s [object Object] fallback for ContentPart[] results.
 */

import type { ExecutableToolResult } from '#/tool/toolContract';

export function outputText(result: ExecutableToolResult): string {
  if (typeof result.output === 'string') return result.output;
  try {
    return JSON.stringify(result.output) ?? '';
  } catch {
    return '';
  }
}
