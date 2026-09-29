/**
 * `hashline` domain — `IHashEditTool` contract.
 *
 * Public contract of the `HashEdit` tool: hash-anchored edits that
 * reference `N#HH` line tags from hashline Read output instead of
 * reproducing content. Supports `replace` (one line, or a `pos`–`end`
 * range), `append` (after `pos`, or at EOF), and `prepend` (before `pos`,
 * or at BOF). All refs validate before anything applies; overlapping
 * ranges are rejected. Bound at Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

const LineRefSchema = z
  .string()
  .regex(/^[0-9]+#[ZPMQVRWSNKTXJBYH]{2}$/)
  .describe('A {line_number}#{hash_id} reference from hashline Read output.');

export const HashEditInputSchema = z
  .object({
    path: z
      .string()
      .describe(
        'Path to the text file to edit. Relative paths resolve against the working directory; a path outside the working directory must be absolute.',
      ),
    op: z.enum(['replace', 'append', 'prepend']).describe('Edit operation.'),
    pos: LineRefSchema.optional().describe(
      'Anchor line. Required for replace and for positioned append/prepend.',
    ),
    end: LineRefSchema.optional().describe('Range end (inclusive) for multi-line replace.'),
    lines: z
      .union([z.string(), z.array(z.string())])
      .describe('Replacement or inserted lines (string with newlines, or array of lines).'),
  })
  .strict();

export type HashEditInput = z.infer<typeof HashEditInputSchema>;

export interface IHashEditTool extends AgentTool<HashEditInput> {
  readonly _serviceBrand: undefined;
}
export const IHashEditTool = createDecorator<IHashEditTool>('hashEditTool');
