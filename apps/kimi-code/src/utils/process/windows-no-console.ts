/**
 * Force CREATE_NO_WINDOW on every Windows child process.
 *
 * Async spawns (spawn / exec / execFile / fork) are covered by patching
 * `ChildProcess.prototype.spawn`: the public API funnels every spawn through
 * that prototype method at call time, so even ESM call sites that captured
 * `spawn` before `main.ts` runs are covered. The method receives the
 * normalized options object on every Node version, and it is where
 * `detached` / `windowsHide` are consumed — folded into spawn flags on
 * newer Node, passed through as the raw object on older Node — so rewriting
 * the two fields there works on both.
 *
 * Sync spawns (spawnSync & friends) never construct a ChildProcess; they go
 * straight to the `spawn_sync` binding, which still takes a single options
 * object on every Node version to date, so that binding is patched directly.
 *
 * The `process_wrap` binding must NOT be patched for the async path: newer
 * Node passes positional arguments to it — the executable path string first —
 * so a binding-level patch writing to "the options" throws
 * `Cannot create property 'windowsHide' on string` and kills every async
 * spawn in the process.
 *
 * `windowsHide: true` is Node's public mapping of CREATE_NO_WINDOW. Without
 * it, console-subsystem children (git.exe, fd.exe, gh.exe, cmd.exe, …)
 * flash a visible window when the TUI is itself a console app.
 *
 * It also forces `detached: false`, which matters just as much. Node maps
 * `detached` to DETACHED_PROCESS, and the CreateProcess flag reference says
 * CREATE_NO_WINDOW "is ignored ... if it is used with either
 * CREATE_NEW_CONSOLE or DETACHED_PROCESS". So a detached child silently
 * loses the hide flag and runs with NO console — and every console-subsystem
 * grandchild it spawns then allocates its OWN visible console window. That is
 * the popup-burst regression, and clearing `detached` here makes it
 * structurally unreachable no matter what a call site passes.
 *
 * Dropping DETACHED_PROCESS costs nothing on Windows: children already
 * outlive the parent (Node puts them in no job object), and CREATE_NO_WINDOW
 * gives each child its own console, so the parent's console closing cannot
 * signal it. The companion CREATE_NEW_PROCESS_GROUP is likewise unnecessary —
 * process trees are killed with `taskkill /T`, not console control events.
 *
 * Interactive logins that already share the parent's console still work:
 * CREATE_NO_WINDOW only suppresses a *new* console, it does not detach
 * inherited stdio.
 */

import { ChildProcess } from 'node:child_process';

type SpawnOptions = { windowsHide?: boolean; detached?: boolean };

type SpawnSyncBinding = {
  spawn: (options: SpawnOptions) => unknown;
};

let installed = false;

function hideWindows(options: SpawnOptions | null | undefined): void {
  // Newer Node hands positional arguments (executable path first) to the
  // native bindings, so anything that is not a real options bag must be
  // left untouched.
  if (options === null || typeof options !== 'object') return;
  // DETACHED_PROCESS makes Windows ignore CREATE_NO_WINDOW, so it must be
  // cleared first or the hide below is a no-op at the OS level.
  if (options.detached === true) options.detached = false;
  if (options.windowsHide === false) return;
  options.windowsHide = true;
}

function processBinding<T>(name: string): T | undefined {
  try {
    return (process as unknown as { binding(name: string): T }).binding(name);
  } catch {
    return undefined;
  }
}

export function installWindowsNoConsole(): void {
  if (installed || process.platform !== 'win32') return;
  installed = true;

  const spawnSyncBinding = processBinding<SpawnSyncBinding>('spawn_sync');
  if (spawnSyncBinding !== undefined) {
    const originalSync = spawnSyncBinding.spawn.bind(spawnSyncBinding);
    spawnSyncBinding.spawn = (options) => {
      hideWindows(options);
      return originalSync(options);
    };
  }

  // Async spawns: ChildProcess.prototype.spawn is the single call-time
  // chokepoint for spawn/exec/execFile/fork on every Node version, and it
  // still receives the normalized options object.
  const childProcessProto = ChildProcess.prototype as unknown as {
    spawn?: (this: unknown, options: SpawnOptions) => unknown;
  };
  const originalChildSpawn = childProcessProto.spawn;
  if (typeof originalChildSpawn === 'function') {
    childProcessProto.spawn = function patchedChildSpawn(
      this: unknown,
      options: SpawnOptions,
    ) {
      hideWindows(options);
      return originalChildSpawn.call(this, options);
    };
  }
}

/** Test-only: whether the no-console patch has been applied in this process. */
export function windowsNoConsoleInstalled(): boolean {
  return installed;
}
