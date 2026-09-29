import { cp, mkdir, readdir, rm, stat, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '../..');
const source = resolve(repoRoot, 'packages/pi-tui/native');
const target = resolve(appRoot, 'native');

// pi-tui ships platform-specific native helpers only for darwin/win32;
// Linux has no native helper, so there is nothing to copy for it.
const PLATFORMS = ['darwin', 'win32'];

async function assertPrebuilds(platform) {
  const dir = resolve(source, platform, 'prebuilds');
  try {
    const info = await stat(dir);
    if (!info.isDirectory()) {
      throw new Error('not a directory');
    }
  } catch {
    throw new Error(
      `pi-tui native prebuilds were not found at ${dir}. Build or restore packages/pi-tui first.`,
    );
  }
  return dir;
}

async function listFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) out.push(full);
    }
  }
  return out;
}

// Windows locks a loaded .node file (EPERM on unlink/overwrite) while any
// andrewcode TUI is still running. Copying that file with a fresh name first
// and skipping the locked one keeps the build green: the still-cached old
// binary keeps working, and the next rebuild (with no TUI running) refreshes
// it. Never fail the whole build over a locked native module.
async function copyTreeTolerant(srcDir, dstDir) {
  await mkdir(dstDir, { recursive: true });
  const skipped = [];
  for (const srcFile of await listFiles(srcDir)) {
    const rel = srcFile.slice(srcDir.length);
    const dstFile = resolve(dstDir, `.${rel}`);
    await mkdir(dirname(dstFile), { recursive: true });
    try {
      await rm(dstFile, { force: true });
    } catch {
      // dest locked — fall through to the copy attempt
    }
    try {
      await copyFile(srcFile, dstFile);
    } catch (error) {
      skipped.push(`${rel} (${error?.code ?? error?.message ?? 'failed'})`);
    }
  }
  return skipped;
}

await rm(target, { recursive: true, force: true }).catch(() => {});
await mkdir(target, { recursive: true });

const skipped = [];
for (const platform of PLATFORMS) {
  const srcPrebuilds = await assertPrebuilds(platform);
  const dstPrebuilds = resolve(target, platform, 'prebuilds');
  skipped.push(...(await copyTreeTolerant(srcPrebuilds, dstPrebuilds)));
}

if (skipped.length > 0) {
  console.warn(
    `warning: kept ${skipped.length} locked native file(s) from the previous build (close running andrewcode sessions to refresh): ${skipped.join(', ')}`,
  );
}
console.log(`Copied pi-tui native prebuilds to ${target}`);
