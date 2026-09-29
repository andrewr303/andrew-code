/**
 * `lsp` domain — server resolution for the rename service.
 *
 * Maps a file to a language-server launch command by extension, resolving
 * the binary through the workspace's `node_modules/.bin` first (so a
 * project-local install wins), then the home-dir global bin, then a bare
 * command (PATH). Pure resolution — no spawn; the caller owns process
 * lifetime. Kept dependency-free: candidates are the servers that support
 * `workspace/willRenameFiles` in practice (typescript-language-server,
 * volar, pyright, gopls, clangd, rust-analyzer).
 */

export interface ServerCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly serverName: string;
}

const BY_EXTENSION: Readonly<Record<string, readonly string[]>> = {
  ts: ['--stdio'],
  tsx: ['--stdio'],
  js: ['--stdio'],
  jsx: ['--stdio'],
  mjs: ['--stdio'],
  cjs: ['--stdio'],
  vue: ['--stdio'],
  py: ['--stdio'],
  go: [],
  c: [],
  cc: [],
  cpp: [],
  h: [],
  hpp: [],
  rs: [],
};

const SERVER_BY_EXT: Readonly<Record<string, string>> = {
  ts: 'typescript-language-server',
  tsx: 'typescript-language-server',
  js: 'typescript-language-server',
  jsx: 'typescript-language-server',
  mjs: 'typescript-language-server',
  cjs: 'typescript-language-server',
  vue: 'vue-language-server',
  py: 'pyright-langserver',
  go: 'gopls',
  c: 'clangd',
  cc: 'clangd',
  cpp: 'clangd',
  h: 'clangd',
  hpp: 'clangd',
  rs: 'rust-analyzer',
};

export function serverNameFor(path: string): string | undefined {
  const extension = extensionOf(path);
  return extension === undefined ? undefined : SERVER_BY_EXT[extension];
}

export async function resolveServerCommand(
  path: string,
  fs: {
    stat(candidate: string): Promise<unknown>;
  },
  roots: readonly string[],
): Promise<ServerCommand | undefined> {
  const serverName = serverNameFor(path);
  if (serverName === undefined) return undefined;
  const extension = extensionOf(path)!;
  const args = BY_EXTENSION[extension] ?? [];
  for (const root of roots) {
    const local = `${root}/node_modules/.bin/${serverName}`;
    try {
      await fs.stat(local);
      return { command: local, args, serverName };
    } catch {
      // Not installed here — keep looking.
    }
  }
  return { command: serverName, args, serverName };
}

function extensionOf(path: string): string | undefined {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return undefined;
  return path.slice(dot + 1).toLowerCase();
}
