/**
 * `lsp` domain — registers the `lsp-rename` experimental flag into `flag`.
 *
 * Gates IDE-grade file rename (LSP `workspace/willRenameFiles` over a
 * spawned language server). Off by default — servers are heavy processes;
 * enable via `KIMI_CODE_EXPERIMENTAL_LSP_RENAME`, the master
 * `KIMI_CODE_EXPERIMENTAL_FLAG`, or the `[experimental]` config section.
 */

import { type FlagDefinitionInput, registerFlagDefinition } from '#/app/flag/flagRegistry';

export const LSP_RENAME_FLAG_ID = 'lsp-rename';
export const LSP_RENAME_FLAG_ENV = 'KIMI_CODE_EXPERIMENTAL_LSP_RENAME';

export const lspRenameFlag: FlagDefinitionInput = {
  id: LSP_RENAME_FLAG_ID,
  title: 'LSP-wired file rename',
  description:
    'Rename files through workspace/willRenameFiles so a language server rewrites imports, re-exports, and barrel files before the move.',
  env: LSP_RENAME_FLAG_ENV,
  default: false,
  surface: 'core',
};

registerFlagDefinition(lspRenameFlag);
