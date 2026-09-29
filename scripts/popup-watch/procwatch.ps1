param([int]$Seconds = 1800)
$ErrorActionPreference = 'SilentlyContinue'
$log = Join-Path $PSScriptRoot 'procwatch-log.jsonl'
if (Test-Path $log) { Remove-Item $log -Force }

$interesting = 'conhost','cmd','git','fd','rg','gh','node','where','clip','taskkill','powershell','pwsh','bash','sh','claude','codex','opencode','copilot','grok'
$known = @{}
$deadline = (Get-Date).AddSeconds($Seconds)

Write-Output "procwatch active -> $log ($Seconds s)"
while ((Get-Date) -lt $deadline) {
  foreach ($name in $interesting) {
    $procs = Get-Process -Name $name -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
      if ($known.ContainsKey($p.Id)) { continue }
      $w = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.Id) -ErrorAction SilentlyContinue
      if (-not $w) { $known[$p.Id] = $true; continue }
      $pp = $null
      if ($w.ParentProcessId) {
        $pw = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $w.ParentProcessId) -ErrorAction SilentlyContinue
        if ($pw) { $pp = @{ name = $pw.Name; pid = $pw.ProcessId; command = $pw.CommandLine } }
      }
      $line = @{
        t = (Get-Date).ToString('o')
        name = $w.Name
        pid = $w.ProcessId
        command = $w.CommandLine
        parent = $pp
      } | ConvertTo-Json -Compress -Depth 5
      Add-Content -Path $log -Value $line
      $known[$p.Id] = $true
    }
  }
  Start-Sleep -Milliseconds 150
}
Write-Output "done"