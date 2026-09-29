#Requires -Version 5.1
<#
.SYNOPSIS
  Put an AndrewCode bin directory first on the Windows User PATH.

.DESCRIPTION
  Safe to re-run. Dedupes the target, moves it to the front of the permanent
  User PATH, mirrors that into the current process, and broadcasts
  WM_SETTINGCHANGE so new processes pick it up without a logoff.

  Can be dot-sourced (defines Update-AndrewCodeUserPath) or invoked:

    powershell -NoProfile -ExecutionPolicy Bypass -File windows-user-path.ps1 -BinDir $home\.andrewcode\bin
#>
[CmdletBinding()]
param(
  [string]$BinDir
)

function Get-AndrewCodeNormalizedPath {
  param([string]$PathValue)
  if ([string]::IsNullOrWhiteSpace($PathValue)) { return '' }
  $trimmed = $PathValue.Trim().TrimEnd('\', '/')
  try {
    return [System.IO.Path]::GetFullPath($trimmed)
  } catch {
    return $trimmed
  }
}

function Publish-AndrewCodeEnvironmentChange {
  try {
    if (-not ('AndrewCode.Native' -as [type])) {
      Add-Type -Namespace AndrewCode -Name Native -MemberDefinition @'
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
  IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
  uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
'@
    }
    $hwndBroadcast = [IntPtr]0xffff
    $wmSettingChange = [uint32]0x001A
    $smtoAbortIfHung = [uint32]0x0002
    $result = [UIntPtr]::Zero
    [void][AndrewCode.Native]::SendMessageTimeout(
      $hwndBroadcast,
      $wmSettingChange,
      [UIntPtr]::Zero,
      'Environment',
      $smtoAbortIfHung,
      [uint32]5000,
      [ref]$result
    )
  } catch {
    # Non-fatal: User PATH is still written; this session / new terminals still work.
  }
}

function Update-AndrewCodeProcessPath {
  param([Parameter(Mandatory = $true)][string]$BinDir)
  $bin = Get-AndrewCodeNormalizedPath $BinDir
  $kept = New-Object System.Collections.Generic.List[string]
  foreach ($part in @($env:Path -split ';')) {
    if ([string]::IsNullOrWhiteSpace($part)) { continue }
    $norm = Get-AndrewCodeNormalizedPath $part
    if ($norm -and ($norm -ieq $bin)) { continue }
    $kept.Add($part.Trim()) | Out-Null
  }
  $env:Path = if ($kept.Count -eq 0) { $bin } else { "$bin;$($kept -join ';')" }
}

function Update-AndrewCodeUserPath {
  param([Parameter(Mandatory = $true)][string]$BinDir)

  if ([string]::IsNullOrWhiteSpace($BinDir)) {
    throw 'BinDir is required'
  }
  if (-not (Test-Path -LiteralPath $BinDir)) {
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  }
  $bin = Get-AndrewCodeNormalizedPath $BinDir

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($null -eq $userPath) { $userPath = '' }

  $kept = New-Object System.Collections.Generic.List[string]
  $removed = 0
  $alreadyFront = $false
  $index = 0
  foreach ($part in @($userPath -split ';')) {
    if ([string]::IsNullOrWhiteSpace($part)) { continue }
    $norm = Get-AndrewCodeNormalizedPath $part
    if ($norm -and ($norm -ieq $bin)) {
      if ($index -eq 0) { $alreadyFront = $true }
      $removed += 1
      continue
    }
    $kept.Add($part.Trim()) | Out-Null
    $index += 1
  }

  $newPath = if ($kept.Count -eq 0) { $bin } else { "$bin;$($kept -join ';')" }
  $changed = -not $alreadyFront -or $removed -gt 1
  if ($changed) {
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  }

  Update-AndrewCodeProcessPath -BinDir $bin
  Publish-AndrewCodeEnvironmentChange

  if (-not $changed) { return 'front' }
  if ($removed -gt 0) { return 'moved' }
  return 'added'
}

# Direct invocation from Node / another script (not dot-sourced).
$invokedAsFile = $MyInvocation.InvocationName -ne '.'
if ($invokedAsFile -and -not [string]::IsNullOrWhiteSpace($BinDir)) {
  $status = Update-AndrewCodeUserPath -BinDir $BinDir
  Write-Output $status
}
