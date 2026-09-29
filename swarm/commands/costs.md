---
description: Fusion cost & status at a glance — which panelists are live, what a panel costs relative to one call, and recent mode/usage from the ledger.
argument-hint: (no args)
---

Show Fusion's current cost posture without running a panel:
- `fusion.sh detect` — which panelists are live (each paid CLI that would run).
- `fusion.sh providers` — the default panel and models.
- `fusion.sh ledger stats` — runs recorded, provider reliability, mode usage.

Then state the cost rule plainly: a Fusion panel is roughly **2–5× the cost of a single
model call** (one call per live panelist + your synthesis); `vote` skips the judge call;
`solo` is 1×. Fusion earns that premium exactly when being wrong is expensive — research,
architecture decisions, high-stakes code — and is overkill for trivial or already-certain
prompts. Do **not** dispatch any panel from this command; it is read-only.
