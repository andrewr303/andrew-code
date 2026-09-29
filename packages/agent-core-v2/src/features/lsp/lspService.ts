/**
 * `lsp` domain — `IFileRenameService` implementation.
 *
 * Spawns the resolved language server through `hostProcess` rooted at the
 * session working directory, drives the `initialize` handshake, issues
 * `workspace/willRenameFiles` for the pending rename, flattens the
 * returned `WorkspaceEdit` (`documentChanges` rename/create/delete ops
 * are ignored — the move itself happens here; only text edits apply),
 * writes each edit through `hostFs`, then performs the rename as a
 * byte-copy + remove. A server error or missing server degrades to the
 * plain move with `serverUsed: false` — the rename never fails because
 * the semantic pass did. The server process is disposed after each call
 * (no long-lived server yet; a per-call spawn keeps Agent scope
 * lifecycle-safe). Bound at Agent scope — contributed by `LspFeature`
 * (`features/lsp/lspFeature`).
 */

import { dirname } from 'pathe';

import { Service } from '#/_base/di/service';
import { IFlagService } from '#/app/flag/flag';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { IHostProcessService } from '#/os/interface/hostProcess';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { LSP_RENAME_FLAG_ID } from './flag';
import { LspClient, fileUriToPath, pathToFileUri } from './lspClient';
import { type FileRenameOutcome, IFileRenameService } from './lsp';
import { resolveServerCommand, type ServerCommand } from './serverResolver';

interface TextEdit {
  readonly range: { readonly start: { line: number; character: number }; end: { line: number; character: number } };
  readonly newText: string;
}

interface WorkspaceEdit {
  readonly changes?: Record<string, readonly TextEdit[]>;
  readonly documentChanges?: readonly unknown[];
}

export class FileRenameService extends Service implements IFileRenameService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IHostProcessService private readonly hostProcess: IHostProcessService,
    @IHostFileSystem private readonly hostFs: IHostFileSystem,
    @ISessionContext private readonly sessionCtx: ISessionContext,
    @IFlagService private readonly flags: IFlagService,
  ) {
    super();
  }

  async serverCommandFor(path: string): Promise<ServerCommand | undefined> {
    if (!this.flags.enabled(LSP_RENAME_FLAG_ID)) return undefined;
    return resolveServerCommand(path, this.hostFs, [this.sessionCtx.cwd]);
  }

  async renameFile(oldPath: string, newPath: string): Promise<FileRenameOutcome> {
    const editedFiles: string[] = [];
    const command = await this.serverCommandFor(oldPath);
    if (command !== undefined) {
      try {
        editedFiles.push(...(await this.applyWillRenameEdits(oldPath, newPath, command)));
      } catch {
        // The semantic pass is best-effort; the move still happens.
      }
    }
    const moved = await this.move(oldPath, newPath);
    return {
      moved,
      serverUsed: command !== undefined,
      editedFiles,
      message: command === undefined ? 'No language server resolved for this file type; moved without import rewrites.' : undefined,
    };
  }

  private async applyWillRenameEdits(
    oldPath: string,
    newPath: string,
    command: ServerCommand,
  ): Promise<readonly string[]> {
    const proc = await this.hostProcess.spawn(command.command, [...command.args], {
      cwd: this.sessionCtx.cwd,
    });
    const client = new LspClient({ root: this.sessionCtx.cwd, name: command.serverName, proc });
    try {
      await client.initialize();
      const edit = (await client.request('workspace/willRenameFiles', {
        files: [
          {
            oldUri: pathToFileUri(oldPath),
            newUri: pathToFileUri(newPath),
          },
        ],
      })) as WorkspaceEdit | null;
      return await this.applyWorkspaceEdit(edit);
    } finally {
      client.dispose();
    }
  }

  private async applyWorkspaceEdit(edit: WorkspaceEdit | null | undefined): Promise<string[]> {
    if (edit === null || edit === undefined) return [];
    const changed: string[] = [];
    for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
      if (edits === undefined || edits.length === 0) continue;
      const path = fileUriToPath(uri);
      changed.push(await this.applyTextEdit(path, edits));
    }
    return changed;
  }

  private async applyTextEdit(path: string, edits: readonly TextEdit[]): Promise<string> {
    const raw = await this.hostFs.readText(path);
    const lines = raw.split('\n');
    // Apply bottom-up so earlier ranges stay valid.
    const ordered = edits.toSorted((left, right) =>
      positionKey(right.range.start) - positionKey(left.range.start),
    );
    for (const edit of ordered) {
      const start = edit.range.start;
      const end = edit.range.end;
      const startLine = Math.min(start.line, lines.length - 1);
      const endLine = Math.min(end.line, lines.length - 1);
      const before = lines[startLine]!.slice(0, start.character);
      const after = lines[endLine]!.slice(end.character);
      const replacement = `${before}${edit.newText}${after}`;
      lines.splice(startLine, endLine - startLine + 1, replacement);
    }
    await this.hostFs.writeText(path, lines.join('\n'));
    return path;
  }

  private async move(oldPath: string, newPath: string): Promise<boolean> {
    try {
      const bytes = await this.hostFs.readBytes(oldPath);
      await this.hostFs.mkdir(dirname(newPath), { recursive: true });
      await this.hostFs.writeBytes(newPath, bytes);
      await this.hostFs.remove(oldPath);
      return true;
    } catch {
      return false;
    }
  }
}

function positionKey(position: { line: number; character: number }): number {
  return position.line * 1_000_000 + position.character;
}
