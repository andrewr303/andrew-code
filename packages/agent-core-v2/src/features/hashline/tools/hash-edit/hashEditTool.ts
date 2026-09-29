/**
 * `hashline` domain — `IHashEditTool` implementation.
 *
 * Resolves the path through the shared path-access rules, reads the file
 * through `hostFs`, validates every `N#HH` anchor against current content
 * (a mismatch rejects before any write, carrying fresh tags), applies the
 * op bottom-up so earlier anchors stay valid, and writes back through
 * `hostFs`. Range replaces validate both ends and reject overlaps
 * implicitly by validating first and splicing once. Bound at Agent scope.
 */

import {
  extendWorkspaceWithSkillRoots,
  resolvePathAccessPath,
  type WorkspaceConfig,
} from '#/tool/path-access';
import { toInputJsonSchema } from '#/tool/input-schema';
import { literalRulePattern, matchesPathRuleSubject } from '#/tool/rule-match';
import { IHostEnvironment } from '#/os/interface/hostEnvironment';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { ISessionSkillCatalog } from '#/session/sessionSkillCatalog/skillCatalog';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import {
  ToolAccesses,
  type ExecutableToolResult,
  type ToolExecution,
} from '#/tool/toolContract';

import { computeLineHash, parseLineRef, validateLineRefs } from '../../hash';
import DESCRIPTION from './hash-edit.md?raw';
import { HashEditInputSchema, IHashEditTool, type HashEditInput } from './hash-edit';

function toLines(value: string | readonly string[]): string[] {
  return typeof value === 'string' ? value.split('\n') : [...value];
}

export class HashEditTool implements IHashEditTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'HashEdit' as const;
  readonly description: string = DESCRIPTION;
  readonly parameters: Record<string, unknown> = toInputJsonSchema(HashEditInputSchema);

  constructor(
    @IHostFileSystem private readonly hostFs: IHostFileSystem,
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

  resolveExecution(args: HashEditInput): ToolExecution {
    const path = resolvePathAccessPath(args.path, {
      env: this.env,
      workspace: this.workspaceConfig,
      operation: 'write',
    });
    return {
      accesses: ToolAccesses.readWriteFile(path),
      description: `Hashline ${args.op} in ${args.path}`,
      display: {
        kind: 'file_io',
        operation: 'edit',
        path,
        before: args.pos ?? '',
        after: typeof args.lines === 'string' ? args.lines : args.lines.join('\n'),
      },
      approvalRule: literalRulePattern(this.name, path),
      matchesRule: (ruleArgs) =>
        matchesPathRuleSubject(ruleArgs, path, {
          cwd: this.workspaceConfig.workspaceDir,
          pathClass: this.env.pathClass,
          homeDir: this.env.homeDir,
        }),
      execute: () => this.execution(args, path),
    };
  }

  private async execution(args: HashEditInput, safePath: string): Promise<ExecutableToolResult> {
    const refs = [args.pos, args.end].filter((ref): ref is string => ref !== undefined);
    let raw: string;
    try {
      raw = await this.hostFs.readText(safePath);
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
    const lines = raw.length === 0 ? [] : raw.split('\n');
    try {
      validateLineRefs(lines, refs);
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
    const inserted = toLines(args.lines);
    try {
      const next = applyOp(lines, args, inserted);
      await this.hostFs.writeText(safePath, next.join('\n'));
      return { output: hashEditSummary(args, safePath, next) };
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
  }
}

function applyOp(lines: string[], args: HashEditInput, inserted: string[]): string[] {
  switch (args.op) {
    case 'replace': {
      if (args.pos === undefined) throw new Error('replace requires "pos".');
      const start = parseLineRef(args.pos).line;
      const end = args.end === undefined ? start : parseLineRef(args.end).line;
      if (end < start) throw new Error(`Invalid range: end ${String(end)} is before pos ${String(start)}.`);
      return [...lines.slice(0, start - 1), ...inserted, ...lines.slice(end)];
    }
    case 'append': {
      if (args.pos === undefined) {
        // A file ending in "\n" splits to a trailing empty element; append
        // inserts before it so the file keeps its trailing newline.
        if (lines.at(-1) === '') return [...lines.slice(0, -1), ...inserted, ''];
        return [...lines, ...inserted];
      }
      const at = parseLineRef(args.pos).line;
      return [...lines.slice(0, at), ...inserted, ...lines.slice(at)];
    }
    case 'prepend': {
      if (args.pos === undefined) return [...inserted, ...lines];
      const at = parseLineRef(args.pos).line;
      return [...lines.slice(0, at - 1), ...inserted, ...lines.slice(at - 1)];
    }
  }
}

function hashEditSummary(args: HashEditInput, path: string, next: string[]): string {
  const anchor =
    args.pos === undefined
      ? 'file edge'
      : `${args.pos}${args.end === undefined ? '' : `–${args.end}`}`;
  const changed = toLines(args.lines).length;
  const fresh: string[] = [];
  if (args.pos !== undefined) {
    const start = parseLineRef(args.pos).line;
    for (let n = start; n < Math.min(start + changed + 1, next.length + 1); n++) {
      fresh.push(`${String(n)}#${computeLineHash(n, next[n - 1] ?? '')}`);
    }
  }
  const lines = [`Applied ${args.op} at ${anchor} in ${path} (${String(changed)} lines).`];
  if (fresh.length > 0) lines.push(`Fresh refs: ${fresh.join(', ')}`);
  return lines.join('\n');
}
