/**
 * `lsp` domain — `IRenameFileTool` implementation.
 *
 * Resolves both paths through the shared path-access rules, delegates to
 * `IFileRenameService`, and reports the outcome — moved or not, whether a
 * language server rewrote references, and which files changed. Bound at
 * Agent scope.
 */

import {
  extendWorkspaceWithSkillRoots,
  resolvePathAccessPath,
  type WorkspaceConfig,
} from '#/tool/path-access';
import { toInputJsonSchema } from '#/tool/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '#/tool/rule-match';
import { IHostEnvironment } from '#/os/interface/hostEnvironment';
import { ISessionSkillCatalog } from '#/session/sessionSkillCatalog/skillCatalog';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import {
  ToolAccesses,
  type ExecutableToolResult,
  type ToolExecution,
} from '#/tool/toolContract';

import DESCRIPTION from './rename-file.md?raw';
import { IFileRenameService } from '../../lsp';
import { IRenameFileTool, RenameFileInputSchema, type RenameFileInput } from './rename-file';

export class RenameFileTool implements IRenameFileTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'RenameFile' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(RenameFileInputSchema);

  constructor(
    @IFileRenameService private readonly renames: IFileRenameService,
    @IHostEnvironment private readonly env: IHostEnvironment,
    @ISessionWorkspaceContext private readonly workspaceCtx: ISessionWorkspaceContext,
    @ISessionSkillCatalog private readonly skillCatalog?: ISessionSkillCatalog,
  ) {}

  private get workspaceConfig(): WorkspaceConfig {
    return extendWorkspaceWithSkillRoots(
      {
        workspaceDir: this.workspaceCtx.workDir,
        additionalDirs: this.workspaceCtx.additionalDirs,
      },
      this.skillCatalog?.catalog.getSkillRoots() ?? [],
      this.env.pathClass,
    );
  }

  resolveExecution(args: RenameFileInput): ToolExecution {
    const oldPath = resolvePathAccessPath(args.path, {
      env: this.env,
      workspace: this.workspaceConfig,
      operation: 'read',
    });
    const newPath = resolvePathAccessPath(args.new_path, {
      env: this.env,
      workspace: this.workspaceConfig,
      operation: 'write',
    });
    return {
      accesses: [
        ...ToolAccesses.readWriteFile(oldPath),
        ...ToolAccesses.writeFile(newPath),
      ],
      description: `Renaming ${args.path} to ${args.new_path}`,
      display: {
        kind: 'file_io',
        operation: 'edit',
        path: oldPath,
        before: args.path,
        after: args.new_path,
      },
      approvalRule: literalRulePattern(this.name, oldPath),
      matchesRule: (ruleArgs) =>
        matchesPathRuleSubject(ruleArgs, oldPath, {
          cwd: this.workspaceConfig.workspaceDir,
          pathClass: this.env.pathClass,
          homeDir: this.env.homeDir,
        }),
      execute: () => this.execution(args, oldPath, newPath),
    };
  }

  private async execution(
    args: RenameFileInput,
    oldPath: string,
    newPath: string,
  ): Promise<ExecutableToolResult> {
    const outcome = await this.renames.renameFile(oldPath, newPath);
    if (!outcome.moved) {
      return { isError: true, output: `Failed to rename ${args.path}: ${outcome.message ?? 'the file could not be moved.'}` };
    }
    const lines = [`Renamed ${args.path} to ${args.new_path}.`];
    lines.push(
      outcome.serverUsed
        ? `Language server rewrote references in ${String(outcome.editedFiles.length)} file(s).`
        : (outcome.message ?? 'No import rewrites were applied.'),
    );
    if (outcome.editedFiles.length > 0) {
      lines.push(...outcome.editedFiles.map((file) => `- ${file}`));
    }
    return { output: lines.join('\n') };
  }
}
