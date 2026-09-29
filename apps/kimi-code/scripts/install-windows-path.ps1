#Requires -Version 5.1
<#
.SYNOPSIS
  Install or update AndrewCode on Windows (shim + User PATH).

.DESCRIPTION
  Delegates to the repo-root install.ps1 so a fresh install and an existing
  install take the same path: refresh deps, rebuild, overwrite shims, move
  the bin dir to the front of User PATH, and refresh this session.

.PARAMETER SkipBuild
  Only rewrite shims / PATH; assume dist\main.mjs already exists.

.PARAMETER BinDir
  Override shim install directory (default: $ANDREWCODE_HOME\bin or
  %USERPROFILE%\.andrewcode\bin).
#>
param(
  [switch]$SkipBuild,
  [string]$BinDir = ''
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir '../..')).Path
$Installer = Join-Path $RepoRoot 'install.ps1'
if (-not (Test-Path -LiteralPath $Installer)) {
  throw "Missing $Installer"
}

$forward = @{
  SkipBuild = $SkipBuild
}
if (-not [string]::IsNullOrWhiteSpace($BinDir)) {
  $forward['BinDir'] = $BinDir
}

& $Installer @forward
exit $LASTEXITCODE
