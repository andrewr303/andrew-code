---
description: Cheap model-free consensus — dispatch the panel and tally answer-keys for a verifiable answer (a number, a fact, one choice). No judge call. Reports the agreement ratio.
argument-hint: <a question with a single checkable answer>
---

Invoke the **fusion-panel** skill with `mode = vote` on:

$ARGUMENTS

Dispatch the panel; extract each panelist's answer-key (last number, else normalized last
line); majority wins, tie-break by panel order. Report the agreement ratio as confidence.
If the vote splits, escalate to a Track-B synthesis — a split means it wasn't as verifiable
as it looked. Record the run (`mode=vote`).
