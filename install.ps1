<#
.SYNOPSIS
  Build and install AndrewCode (shims + PATH).

.DESCRIPTION
  Thin wrapper around scripts/install-andrewcode.mjs (which delegates to
  apps/kimi-code/scripts/install-path.mjs). Builds all packages + the CLI
  bundle, writes `andrewcode`/`kimi` shims to ~/.andrewcode/bin, moves that
  dir to the front of the User PATH, and runs smoke checks.

  Safe to re-run over an existing install.

.PARAMETER SkipBuild
  Skip pnpm install + rebuild. Only rewrites shims, PATH, and smoke tests.
  Use when dist/main.mjs is already fresh (e.g. after `pnpm -C apps/kimi-code run build`).

.PARAMETER BinDir
  Override the shim directory (default: $env:ANDREWCODE_HOME\bin or ~/.andrewcode/bin).

.EXAMPLE
  .\install.ps1
.EXAMPLE
  .\install.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [string]$BinDir
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSCommandPath
$entry = Join-Path $repoRoot 'scripts/install-andrewcode.mjs'

if (-not (Test-Path $entry)) {
  throw "Cannot find $entry. Run this script from the andrew-code checkout root."
}

if ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node is not on PATH. Install Node >= 24.15.0 first (see .nvmrc).'
}
if ($null -eq (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  throw 'pnpm is not on PATH. Install pnpm 10.33.0: https://pnpm.io/installation'
}

$nodeArgs = @($entry)
if ($SkipBuild) { $nodeArgs += '--skip-build' }
if ($BinDir) { $nodeArgs += @('--bin-dir', $BinDir) }

& node @nodeArgs
if ($LASTEXITCODE -ne 0) {
  throw "install failed (exit $LASTEXITCODE)"
}

Write-Host ''
Write-Host 'AndrewCode installed. If this shell still resolves an old `andrewcode`, open a new terminal.' -ForegroundColor Green
Write-Host 'Verify with:  andrewcode --version ; andrewcode login --status' -ForegroundColor Green
