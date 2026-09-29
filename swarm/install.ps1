# fusion/install.ps1 — Windows (PowerShell) launcher for the Fusion installer.
#
# Fusion's scripts run under Git Bash (a hard requirement), so this thin launcher
# locates Git Bash and delegates to install.sh, passing your flags through.
#
#   .\install.ps1                 # full install (prep + verify + register, user scope)
#   .\install.ps1 -Smoke          # also run a live one-word dispatch per panelist
#   .\install.ps1 -NoRegister     # prep + verify only; print the /plugin commands
#   .\install.ps1 -Scope project  # register at project scope (user|project|local)
#   .\install.ps1 -DryRun         # show what it would do; no side effects
param(
  [switch]$Smoke,
  [switch]$NoRegister,
  [string]$Scope = "user",
  [switch]$DryRun
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot -replace '\\', '/'

# Locate Git Bash — NOT WSL's System32\bash.exe (the plugin needs the Windows CLIs).
$candidates = @(
  "$env:ProgramFiles\Git\bin\bash.exe",
  "$env:ProgramFiles\Git\usr\bin\bash.exe",
  "${env:ProgramFiles(x86)}\Git\bin\bash.exe"
)
$bash = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $bash) {
  $found = (Get-Command bash -ErrorAction SilentlyContinue).Source
  if ($found -and $found -notmatch 'System32') { $bash = $found }
}
if (-not $bash) {
  Write-Host "Git Bash not found. Install Git for Windows (https://git-scm.com/download/win)" -ForegroundColor Red
  Write-Host "— Fusion's scripts and Python engine require Git Bash at runtime." -ForegroundColor Red
  exit 1
}

$flags = @()
if ($Smoke)      { $flags += "--smoke" }
if ($NoRegister) { $flags += "--no-register" }
if ($DryRun)     { $flags += "--dry-run" }
$flags += @("--scope", $Scope)

& $bash "$root/install.sh" @flags
exit $LASTEXITCODE
