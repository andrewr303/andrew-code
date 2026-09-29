/**
 * `hashline` domain — content-hash line anchoring (Hashline).
 *
 * Every line the agent reads can be tagged `N#HH|content` where `HH` is a
 * two-character content hash: FNV-1a over the trimmed line (seeded with the
 * line number for blank/insignificant lines so position still binds),
 * mapped through a 16-symbol alphabet that avoids confusables. Edits
 * reference those tags instead of reproducing content; a tag whose hash no
 * longer matches means the file moved underneath the agent, and the edit
 * is rejected before any corruption — with fresh tags for the changed
 * lines. Pure functions, no DI. Ported from oh-my-openagent's
 * `hashline-core` (xxHash32 replaced with FNV-1a to avoid a native
 * dependency; the wire format `N#HH` is unchanged).
 */

const NIBBLE = 'ZPMQVRWSNKTXJBYH';

const SIGNIFICANT = /[\p{L}\p{N}]/u;

export const HASHLINE_REF_PATTERN = /^([0-9]+)#([ZPMQVRWSNKTXJBYH]{2})$/;

function fnv1a32(text: string, seed: number): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function computeLineHash(lineNumber: number, content: string): string {
  const normalized = content.replaceAll('\r', '').trimEnd();
  const seed = SIGNIFICANT.test(normalized) ? 0 : lineNumber;
  const byte = fnv1a32(normalized, seed) % 256;
  return `${NIBBLE[byte >>> 4]!}${NIBBLE[byte & 0x0f]!}`;
}

export function formatHashLine(lineNumber: number, content: string): string {
  return `${String(lineNumber)}#${computeLineHash(lineNumber, content)}|${content}`;
}

export interface ParsedLineRef {
  readonly line: number;
  readonly hash: string;
}

export function parseLineRef(ref: string): ParsedLineRef {
  const match = HASHLINE_REF_PATTERN.exec(ref.trim());
  if (match === null) {
    throw new Error(
      `Invalid line reference "${ref}". Expected format: "{line_number}#{hash_id}".`,
    );
  }
  return { line: Number.parseInt(match[1]!, 10), hash: match[2]! };
}

export class HashlineMismatchError extends Error {
  constructor(
    readonly mismatches: readonly { line: number; expected: string }[],
    fileLines: readonly string[],
  ) {
    super(formatMismatchMessage(mismatches, fileLines));
    this.name = 'HashlineMismatchError';
  }
}

function formatMismatchMessage(
  mismatches: readonly { line: number; expected: string }[],
  fileLines: readonly string[],
): string {
  const changed = new Set(mismatches.map((entry) => entry.line));
  const shown = new Set<number>();
  for (const { line } of mismatches) {
    for (let n = Math.max(1, line - 2); n <= Math.min(fileLines.length, line + 2); n++) {
      shown.add(n);
    }
  }
  const lines = [...shown].sort((a, b) => a - b);
  const out = [
    `${String(mismatches.length)} line${mismatches.length === 1 ? ' has' : 's have'} changed since last read. Use the updated {line_number}#{hash_id} references below (>>> marks changed lines).`,
    '',
  ];
  let previous = -1;
  for (const n of lines) {
    if (previous !== -1 && n > previous + 1) out.push('    ...');
    previous = n;
    const prefix = `${String(n)}#${computeLineHash(n, fileLines[n - 1] ?? '')}|${fileLines[n - 1] ?? ''}`;
    out.push(changed.has(n) ? `>>> ${prefix}` : `    ${prefix}`);
  }
  return out.join('\n');
}

export function validateLineRefs(lines: readonly string[], refs: readonly string[]): void {
  const mismatches: { line: number; expected: string }[] = [];
  for (const ref of refs) {
    const { line, hash } = parseLineRef(ref);
    if (line < 1 || line > lines.length) {
      throw new Error(`Line number ${String(line)} out of bounds (file has ${String(lines.length)} lines).`);
    }
    if (computeLineHash(line, lines[line - 1] ?? '') !== hash) {
      mismatches.push({ line, expected: hash });
    }
  }
  if (mismatches.length > 0) throw new HashlineMismatchError(mismatches, lines);
}
