---
description: Builder vs Breaker — a builder writes a solution, an adversary writes RUNNABLE failing tests / edge cases / security probes, the test runner judges, and the builder fixes; loop until the breaker can't break it. Robust code, not "looked fine".
argument-hint: <task> [--builder codex] [--breaker grok] [--rounds 2] [--gate-cmd "<verify>"] [--cwd <dir>]
---

Invoke the **fusion-swarms** skill and run Builder-vs-Breaker on:

$ARGUMENTS

Run `bash $FUSION_PLUGIN_ROOT/scripts/swarm.sh breaker "<task>" --builder <P|codex> --breaker <P|grok> --rounds <N|2> [--gate-cmd "<verify>"] [--cwd <dir>] --json`.
The breaker (a different, contrarian model) must produce executable counterexamples; with a
`--gate-cmd` the gate is the judge (hard mode), else the builder hardens defensively each
round. Present the final, hardened solution + whether the adversary was exhausted, and record
the run (`task_type: swarm:breaker`). Best for security/auth/payments/parsers — anywhere
"looks right" is dangerous. Keep the breaker's tests afterward as free regression coverage.
