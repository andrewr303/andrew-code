# A complete Fusion run (real, unedited inputs)

This is an actual `panel` run captured during development — the four panelists' answers are
their **real, verbatim** outputs; the synthesis below is the conductor (Claude Opus 4.8)
applying the Track-B judge rubric to them. It's here as a worked example of what a Fusion
verdict looks like end to end, in the `verdict-contract` format.

**Task:** *"In one paragraph (<120 words): what is the single most common root cause of memory
leaks in long-running Node.js services, and the most reliable way to detect it in
production?"*

**Mode chosen:** `panel` (open-ended research, one clear deliverable, tool-using → the
canonical fusion case). Panel: 🔴 codex/gpt-5.5 · 🔷 copilot/gemini · 🟢 opencode/glm-5.2 ·
⬛ grok. Judge: 🔵 claude.

---

## The answer (Fusion's voice)

The dominant root cause is **unintended retention**: short-lived objects (per-request data,
handlers) staying reachable through long-lived references — unbounded caches/`Map`s, timers
never cleared, and event listeners accumulating on persistent emitters or closures — so V8's
garbage collector can never reclaim them. It is almost never "lost" memory in the C sense; it
is a retained-object graph that grows monotonically.

The most reliable production detection is **diffing successive V8 heap snapshots**
(`v8.writeHeapSnapshot()` / `getHeapSnapshot()`, triggered on a memory threshold or signal)
and comparing them in Chrome DevTools' comparison + **retainers** view to find which object
types grow and the exact reference paths holding them. Two refinements the panel converged on
and that materially improve signal: compare heap **after a full GC** (so you measure retained,
not transient, memory), and corroborate with a `process.memoryUsage().heapUsed` /​ RSS trend
plus `--trace-gc` to confirm growth is monotonic *between* collections — metrics show the
symptom, snapshot diffs show the cause.

*Confidence: high — four independent models, each with web access, converged on the same root
cause and the same primary detection method.*

---
## ✦ Fusion audit trail
**mode:** panel
**panel:** 🔴 codex returned · 🔷 copilot returned · 🟢 opencode returned · ⬛ grok returned
**judge:** 🔵 claude (Opus 4.8)
**consensus:** 4/4 on root cause (retained references defeating GC) and on primary detection
(diff successive heap snapshots). No contradictions.

**five-section analysis:**
- **Consensus (high-confidence):** unbounded caches / uncleared timers / leaked listeners /
  closures hold references the GC can't free; detect by diffing heap snapshots and inspecting
  the retained/dominator graph. All four reached this independently.
- **Contradictions:** none material.
- **Partial coverage:** *post-full-GC* heap comparison (codex) and the `--trace-gc` + RSS/
  `heapUsed` trend corroboration (opencode) were each raised by one model — both promoted into
  the answer because they're concrete, verifiable improvements to detection signal.
- **Unique insights:** grok supplied named, checkable tooling/sources (Chrome DevTools
  retainers view; LogRocket/Netdata/Sematext guides); copilot framed the production constraint
  (low-overhead snapshotting / APM).
- **Blind spots:** none addressed *prevention* (bounded caches via `lru-cache`, `AbortSignal`/
  cleanup for listeners, `FinalizationRegistry` for diagnostics) or *automated regression
  guards* in CI — added by the judge as the natural next step the panel missed.

**cost:** panel ≈ 4 model calls + synthesis (~4–5× a single call).

**kill criteria:** If, after instrumenting heap-snapshot diffing under real traffic, `heapUsed`
**after full GC** is flat across a 24h window with steady load, this service does **not** have
the described leak — stop here and look elsewhere (native addons / RSS fragmentation).

**next step:** Add a signal-triggered `v8.writeHeapSnapshot()` endpoint (gated, off by default)
plus a `--trace-gc` + `heapUsed`-after-GC dashboard panel; capture two snapshots ~1h apart
under load and diff the retainers view.

---

> Why this beats one model: no single panelist gave the *complete* answer. codex contributed
> the post-GC baseline, opencode the `--trace-gc`/RSS corroboration, grok the named tooling,
> copilot the low-overhead framing — and none mentioned prevention or CI guards, which the
> judge supplied. The fused verdict is stronger and better-calibrated than any of the four
> inputs alone. That is the entire point of Fusion.
