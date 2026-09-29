import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FUSION_PLUGIN_ROOT_ENV, PACKAGED_FUSION_PLUGIN_DIR_NAME } from '#/constant/app';
import { getHostPackageRoot } from './version';

/**
 * Locate the packaged fusion-plugin directory shipped with the CLI app.
 *
 * Checks the package root (derived from package.json or import.meta.url).
 * Returns the absolute path if found, or null if the packaged directory
 * does not exist (e.g. in dev before copy-fusion-plugin runs).
 */
export function resolvePackagedFusionPluginDir(): string | null {
  try {
    const pkgRoot = getHostPackageRoot();
    const candidate = join(pkgRoot, PACKAGED_FUSION_PLUGIN_DIR_NAME);
    if (existsSync(candidate)) {
      return candidate;
    }
  } catch {
    // Fall back to import.meta.url traversal if package.json search fails
  }

  try {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    for (const parent of [resolve(moduleDir, '..'), resolve(moduleDir, '../..')]) {
      const candidate = join(parent, PACKAGED_FUSION_PLUGIN_DIR_NAME);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  } catch {
    // Best-effort path resolution
  }

  return null;
}

/**
 * Set process.env.FUSION_PLUGIN_ROOT to the packaged fusion-plugin directory
 * when:
 * 1. FUSION_PLUGIN_ROOT is currently unset
 * 2. The packaged fusion-plugin directory exists on disk
 *
 * Runs synchronously during early startup before harness/TUI initialization.
 * Never spawns any child process.
 */
export function installPackagedFusionPluginEnv(): void {
  if (process.env[FUSION_PLUGIN_ROOT_ENV]) {
    return;
  }
  const pluginDir = resolvePackagedFusionPluginDir();
  if (pluginDir !== null) {
    process.env[FUSION_PLUGIN_ROOT_ENV] = pluginDir;
  }
}
