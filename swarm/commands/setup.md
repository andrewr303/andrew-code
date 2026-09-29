---
description: Set up and health-check Fusion — detect which panelist CLIs are installed/authed, run a tiny live smoke test to prove dispatch works, and review/adjust panel config.
argument-hint: [--smoke] [--config]
---

Invoke the **fusion-setup** skill.

Args: $ARGUMENTS

Run `fusion.sh detect` and `fusion.sh providers`; report each panelist's state and how to
fix any that are missing/degraded. With `--smoke`, dispatch a one-word live prompt to each
live panelist to prove real (non-simulated) dispatch. With `--config`, show the overridable
models/effort/timeouts/allowlist. End with a one-line readiness summary (live panelist count
+ the cost reminder).
