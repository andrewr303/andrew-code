/**
 * `lsp` domain — `IRenameFileTool` contract.
 *
 * Public contract of the `RenameFile` tool: move a file with IDE-grade
 * import rewrites first (LSP `workspace/willRenameFiles`), plain-move
 * fallback when no language server is available for the type. Bound at
 * Agent scope.
 */

import { z } from 'zod';

import { createDecorator } from '#/_base/di/instantiation';
import type { AgentTool } from '#/tool/toolContract';

export const RenameFileInputSchema = z
  .object({
    path: z
      .string()
      .describe('The file to rename. Relative paths resolve against the working directory.'),
    new_path: z
      .string()
      .describe('Destination path (with the new file name). Relative paths resolve against the working directory.'),
  })
  .strict();

export type RenameFileInput = z.infer<typeof RenameFileInputSchema>;

export interface IRenameFileTool extends AgentTool<RenameFileInput> {
  readonly _serviceBrand: undefined;
}
export const IRenameFileTool = createDecorator<IRenameFileTool>('renameFileTool');
