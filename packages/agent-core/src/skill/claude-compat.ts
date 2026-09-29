import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'pathe';

import type { SkillRoot } from './types';

const SKIP_DIR_NAMES = new Set([
  'cache',
  'marketplaces',
  'known_marketplaces',
  'node_modules',
  '.git',
]);

export async function discoverClaudeCompatSkillRoots(options: {
  readonly osHomeDir?: string;
  readonly projectRoot?: string;
  readonly isDir?: (p: string) => Promise<boolean>;
  readonly readdir?: (p: string) => Promise<readonly string[]>;
}): Promise<readonly SkillRoot[]> {
  const isDir = options.isDir ?? defaultIsDir;
  const readdir = options.readdir ?? ((p: string) => fs.readdir(p));
  const osHome = options.osHomeDir ?? homedir();
  const candidates = [
    path.join(osHome, '.claude', 'plugins'),
    path.join(osHome, '.claude', 'skills'),
    ...(options.projectRoot === undefined
      ? []
      : [
          path.join(options.projectRoot, '.claude', 'plugins'),
          path.join(options.projectRoot, '.claude', 'skills'),
        ]),
  ];
  const roots: SkillRoot[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (!(await isDir(candidate))) continue;
    if (candidate.endsWith(`${path.sep}skills`) || candidate.endsWith('/skills')) {
      push(roots, seen, candidate, 'extra');
      continue;
    }
    let entries: readonly string[];
    try {
      entries = await readdir(candidate);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (SKIP_DIR_NAMES.has(name)) continue;
      const pluginRoot = path.join(candidate, name);
      if (!(await isDir(pluginRoot))) continue;
      const nestedSkills = path.join(pluginRoot, 'skills');
      if (await isDir(nestedSkills)) {
        push(roots, seen, nestedSkills, 'extra');
      } else {
        push(roots, seen, pluginRoot, 'extra');
      }
    }
  }
  return roots;
}

function push(roots: SkillRoot[], seen: Set<string>, dir: string, source: SkillRoot['source']): void {
  const normalized = dir.replaceAll('\\', '/');
  if (seen.has(normalized)) return;
  seen.add(normalized);
  roots.push({ path: normalized, source });
}

async function defaultIsDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}
