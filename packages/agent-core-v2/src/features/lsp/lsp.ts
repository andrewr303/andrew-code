/**
 * `lsp` domain — `IFileRenameService` contract.
 *
 * IDE-grade file rename (oh-my-pi's `rename_file`): before the file moves,
 * the request goes to a workspace-rooted language server via
 * `workspace/willRenameFiles`, so re-exports, barrel files, and aliased
 * imports update first; the returned `WorkspaceEdit` is applied, then the
 * file itself is renamed. When no server can be resolved for the file
 * type, `renameFile` falls back to a plain move with an explicit
 * `serverUsed: false` in the outcome so callers can surface the
 * difference. Bound at Agent scope — contributed into every Agent scope
 * by `LspFeature` (`features/lsp/lspFeature`).
 */

import { createDecorator } from '#/_base/di/instantiation';

export interface FileRenameOutcome {
  readonly moved: boolean;
  readonly serverUsed: boolean;
  readonly editedFiles: readonly string[];
  readonly message?: string;
}

export interface IFileRenameService {
  readonly _serviceBrand: undefined;

  /** Resolve whether a language server exists for this file (test/UX hook). */
  serverCommandFor(path: string): Promise<{ command: string; args: readonly string[] } | undefined>;

  /** Rename with import rewrites; falls back to a plain move when no server. */
  renameFile(oldPath: string, newPath: string): Promise<FileRenameOutcome>;
}

export const IFileRenameService = createDecorator<IFileRenameService>('fileRenameService');
