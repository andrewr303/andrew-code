/**
 * `lsp` domain — `LspFeature`: the IDE-wired file rename capability
 * assembled as one App-scope Feature unit.
 *
 * Contributes the per-Agent `IFileRenameService` and the `RenameFile`
 * agent tool through the `features` base-class seams; retracting the unit
 * withdraws both across the scope tree. The `lsp-rename` flag
 * (`features/lsp/flag`) stays on its static import=register channel.
 * Registered into the feature table at import.
 */

import { Feature } from '#/features/feature';
import { registerFeature } from '#/features/featureRegistry';

import './flag';
import { IFileRenameService } from './lsp';
import { FileRenameService } from './lspService';
import { IRenameFileTool } from './tools/rename-file/rename-file';
import { RenameFileTool } from './tools/rename-file/renameFileTool';

export class LspFeature extends Feature {
  static override readonly name = 'lsp';

  constructor() {
    super();
    this.contributeAgentService(IFileRenameService, FileRenameService);
    this.contributeTool(IRenameFileTool, RenameFileTool, { name: 'RenameFile', domain: 'edit' });
  }
}

registerFeature(LspFeature);
