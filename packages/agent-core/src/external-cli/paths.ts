import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the vendored Fusion plugin root (`fusion/` at the monorepo root).
 *
 * Order:
 * 1. `FUSION_PLUGIN_ROOT` env
 * 2. Walk up from `process.cwd()` looking for `fusion/scripts/fusion.sh`
 * 3. Walk up from this module (monorepo-relative) looking for the same
 */
export function resolveFusionRoot(startDir?: string): string | undefined {
  const fromEnv = process.env['FUSION_PLUGIN_ROOT']?.trim();
  if (fromEnv && existsSync(join(fromEnv, 'scripts', 'fusion.sh'))) {
    return resolve(fromEnv);
  }

  const seeds: string[] = [];
  if (startDir !== undefined) seeds.push(startDir);
  seeds.push(process.cwd());
  try {
    seeds.push(dirname(fileURLToPath(import.meta.url)));
  } catch {
    // import.meta.url unavailable in some bundled contexts
  }

  for (const seed of seeds) {
    const found = walkForFusion(seed);
    if (found !== undefined) return found;
  }
  return undefined;
}

function walkForFusion(start: string): string | undefined {
  let dir = resolve(start);
  for (let i = 0; i < 12; i++) {
    const candidate = join(dir, 'fusion');
    if (existsSync(join(candidate, 'scripts', 'fusion.sh'))) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Default home for Fusion memory / ledger state. */
export function resolveFusionStateDir(homeDir?: string): string {
  const fromEnv = process.env['FUSION_STATE_DIR']?.trim();
  if (fromEnv) return resolve(fromEnv);
  const home = homeDir ?? process.env['HOME'] ?? process.env['USERPROFILE'] ?? '.';
  return join(home, '.fusion');
}
