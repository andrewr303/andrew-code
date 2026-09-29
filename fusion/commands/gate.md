---
description: Verification Gate — run a real check (tests / typecheck / build / lint) and report pass/fail + logs. For code, the test runner is a harder arbiter than any vote. Auto-detects a command if none given.
argument-hint: [--gate-cmd "pytest -q"] [--cwd <dir>]
---

Invoke the **fusion-swarms** skill and run the Verification Gate.

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh gate --gate-cmd "<verification command>" --cwd <dir>`
(omit `--gate-cmd` to auto-detect: pytest / npm test / tsc --noEmit / build). Report the
pass/fail + log tail plainly. This is the *hard* arbiter the swarm structures use — a green
run is ground truth, a judge model is only a soft opinion. **Safety:** only ever pass
NON-DESTRUCTIVE verification commands; the gate executes what it's given.
