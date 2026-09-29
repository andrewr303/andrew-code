# Windows popup-console forensics

Two tools that answer "which process just flashed a console window on my
screen?" No admin rights needed.

## Why Windows pops these windows

Node maps `detached: true` to `DETACHED_PROCESS` and `windowsHide: true` to
`CREATE_NO_WINDOW`. Per the [CreateProcess flag reference][flags],
`CREATE_NO_WINDOW` "is ignored ... if it is used with either
`CREATE_NEW_CONSOLE` or `DETACHED_PROCESS`".

So a **detached** child gets no console at all, and every console-subsystem
grandchild it spawns (git, gh, fd, rg, npm) allocates its OWN visible console
window. `windowsHide` **alone** gives the child a hidden console that its
grandchildren inherit, which is what keeps the whole tree invisible.

When you find a popup, the fix is almost always to drop `detached` on
Windows, not to add more hiding.

[flags]: https://learn.microsoft.com/en-us/windows/win32/procthread/process-creation-flags

## winwatch.exe — window-creation hook

Logs every top-level window create/show/destroy with owning PID, title,
size, and visibility. Catches sub-100ms flashes a poller would miss.

The binary is deliberately not checked in; build it with any recent .NET SDK:

```powershell
dotnet build .\scripts\popup-watch\src\WinWatch.csproj -c Release
$exe = ".\scripts\popup-watch\src\bin\Release\net10.0-windows\winwatch.exe"
& $exe "$env:TEMP\winevent.jsonl" 300   # 5-minute capture
```

Each line is JSON: `{t, ev, hwnd, pid, vis, w, h, title}`.
`ev`: 32768 = created, 32770 = shown, 32769 = destroyed.

Source: `src/WinWatch.cs` + `src/WinWatch.csproj`.

## procwatch.ps1 — process-tree watcher

Polls every 150ms for new `conhost/cmd/git/gh/fd/rg/node/powershell/pwsh/
bash/where/clip/taskkill/npm` processes and records the parent chain plus
full command line.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\popup-watch\procwatch.ps1 -Seconds 300
```

Output: `.tmp/procwatch-log.jsonl` — one JSON object per new process:
`{t, name, pid, command, parent: {name, pid, command}}`.

## Correlating the two

A popup is a window event with `vis:true`, `w:0`, `h:0` (born at zero size,
shown, then destroyed). Match its timestamp against procwatch entries within
+/-2s to find the spawner, and keep walking `parent` up the tree.
