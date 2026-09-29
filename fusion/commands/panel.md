---
description: Run the canonical Fusion panel — dispatch blind and in parallel to all live CLIs, then judge and synthesize one grounded answer. The workhorse mode for research and clear-deliverable code.
argument-hint: <task or question> [--vote | --ranked]
---

Invoke the **fusion-panel** skill and run the Conductor with `mode = panel` on:

$ARGUMENTS

Build the panel prompt (task verbatim + fixed neutral instruction, no personas; paste any
local-file context). `fusion.sh panel` to fan out blind+parallel. Mark non-returning
panelists absent. Judge: Track A (run-the-code-and-merge) for code, Track B (five-section
synthesis) for research. If `--vote`, use the model-free majority on the answer-key; if
`--ranked`, pick the single best whole answer. Present with the audit trail and record the
run with honest per-panelist ranks.
