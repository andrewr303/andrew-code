---
"@moonshot-ai/kimi-code": patch
"@moonshot-ai/agent-core-v2": patch
"@moonshot-ai/agent-core": patch
"@moonshot-ai/kap-server": patch
"@moonshot-ai/kaos": patch
---

Stop bursts of popup terminal windows on Windows.

Two independent causes, both measured with a window-creation hook.

The one users actually saw was the PR badge. `gh pr view` spawns its own
`git.exe` children with `CREATE_NO_WINDOW`, and that flag does not suppress a
console — it ALLOCATES a new one without a window. When the default terminal
application is Windows Terminal (the Windows 11 default), every new console is
handed off to Terminal, which renders it as a real, visible window. A single
`gh pr view` measured seven to nine terminal windows flashing across the
desktop, and the footer polled it on every render and every 60 seconds. Those
spawns happen inside `gh.exe`, so no spawn option on our side can suppress
them; the gh-backed PR lookup is now opt-in on Windows via
`KIMI_CODE_PR_BADGE=1`, in the TUI footer and in both git services. Measured
after the change: a full session with typing creates zero extra windows, down
from eight or nine per launch.

Separately, spawns that paired `detached: true` with `windowsHide: true` were
self-defeating: Windows ignores `CREATE_NO_WINDOW` whenever `DETACHED_PROCESS`
is present, so those children ran with no console and any console grandchild
they spawned allocated a visible one. Windows spawns are no longer detached
(the kaos shell backend behind every Bash tool call, the v2 host process
service, both git services, the footer lookup, the background updater, and the
OS file launcher); POSIX keeps `detached` for process-group tree kills. The CLI
also clears `detached` in its native spawn backstop so no call site can
reintroduce it.
