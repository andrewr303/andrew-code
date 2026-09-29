# Installing AndrewCode

One-command build + install from this checkout. Re-running updates an
existing install in place and is the normal way to pick up new code.

## Windows (PowerShell)

```powershell
.\install.ps1            # full: pnpm install + build + shims + PATH + smoke
.\install.ps1 -SkipBuild # shims + PATH + smoke only (dist/ already built)
```

## macOS / Linux (bash)

```bash
./install.sh              # full build + shims + smoke
./install.sh --skip-build # shims only
./install.sh --write-rc   # also append the PATH export to your shell rc
```

Both are thin wrappers: `install.ps1` → `scripts/install-andrewcode.mjs`
→ `apps/kimi-code/scripts/install-path.mjs` (the real build + shim logic).
Keep the wrappers thin — put new install behavior in `install-path.mjs`.

## What the installer does

1. Checks prerequisites (Node ≥ 24.15.0, pnpm 10.33.0).
2. `pnpm install`, then builds every package plus the CLI bundle
   (`apps/kimi-code/dist/main.mjs`).
3. Writes `andrewcode` / `kimi` shims into `~/.andrewcode/bin`
   (`%USERPROFILE%\.andrewcode\bin`, or `$ANDREWCODE_HOME\bin`), retargeting
   any existing shim to this checkout.
4. Moves that bin dir to the front of the permanent **User** PATH (Windows)
   or prints/adds the export line (POSIX).
5. Runs smoke checks (`--version`, `login --status`, shim `--version`).

Then open a **new** terminal (running shells keep the old PATH) and verify:

```powershell
andrewcode --version
andrewcode login --status
```

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Old `andrewcode` still runs | Shell cached the old PATH or shim. Open a new terminal, or run `.\install.ps1` again — it force-moves the bin dir to the front of User PATH. |
| Build fails with `EPERM ... .node` on Windows | A running andrewcode TUI holds the native module. Close all andrewcode sessions and re-run; since Sep 2026 the native-asset copy warns instead of failing, but a fully fresh copy needs no TUIs running. |
| `pnpm install` fails on Node version | `.npmrc` sets `engine-strict=true`; install Node 24.15+ (see `.nvmrc`). |
| `spawn npm.cmd EINVAL` during update preflight | Expected on Windows: bare `.cmd` spawns without a shell are blocked (CVE-2024-27980). The updater treats it as "source unknown", never as a fatal error. |

## No more popup console windows?

Console flashes when spawning helper processes were fixed by giving
Windows children a *hidden* console their grandchildren inherit
(`detached:true + windowsHide:true`), instead of hiding the parent outright
— a consoleless parent makes every console grandchild open its own visible
window. If flashes return, capture them with
[`scripts/popup-watch/`](scripts/popup-watch/README.md) and correlate the
window-creation log with the process-tree log before changing spawn code.
