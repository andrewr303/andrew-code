import { cpSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const source = resolve(repoRoot, 'swarm');
const target = resolve(appRoot, 'fusion-plugin');

if (!existsSync(source)) {
  throw new Error(
    `Fusion swarm source directory was not found at ${source}. Ensure swarm/ exists in the repo root.`,
  );
}

try {
  const sourceStat = statSync(source);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Fusion swarm source at ${source} is not a directory.`);
  }
} catch (error) {
  throw new Error(`Failed to access Fusion swarm source at ${source}: ${error?.message ?? error}`);
}

function shouldExclude(rel) {
  if (!rel) return false;
  const normalized = rel.split('\\').join('/');
  const segments = normalized.split('/');

  if (segments.includes('__pycache__')) return true;
  if (segments.includes('.git')) return true;
  if (segments.includes('tests')) return true;
  if (normalized.endsWith('.pyc')) return true;
  if (normalized.endsWith('.pdf')) return true;
  if (normalized === 'config/.backups' || normalized.startsWith('config/.backups/')) return true;
  if (normalized === 'memory/runs.jsonl' || normalized.endsWith('/runs.jsonl')) return true;
  if (normalized === 'ultracode/docs' || normalized.startsWith('ultracode/docs/')) return true;
  if (normalized === 'ultracode/examples' || normalized.startsWith('ultracode/examples/')) return true;

  return false;
}

// Idempotent: remove target directory first
if (existsSync(target)) {
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
mkdirSync(target, { recursive: true });

cpSync(source, target, {
  recursive: true,
  filter: (src) => {
    const rel = relative(source, src);
    return !shouldExclude(rel);
  },
});

console.log(`Copied Fusion swarm plugin from ${source} to ${target}`);
