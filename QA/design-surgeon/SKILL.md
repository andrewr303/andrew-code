---
name: design-surgeon
description: Deep UI design audit and anti-AI-slop implementation workflow for Codex or Claude Code. Use when asked to improve, redesign, de-slop, audit, polish, harden, or implement UI/frontend/product design changes. Starts with read-only analysis, returns numbered top/medium/radical improvement tables, then implements only selected row IDs with optional backup and rollback.
---

# Design Surgeon

Design Surgeon is a controlled design agent for UI/product surfaces. It combines static code audit, live browser inspection, anti-AI-slop design critique, numbered implementation planning, backup, rollback, and verification.

## Non-negotiable behavior

- Audit mode is read-only.
- Do not implement changes until the user selects row IDs.
- Preserve behavior, data logic, auth, routes, feature flags, and product terminology.
- Use Playwright or browser tooling when possible for serious UI claims.
- Use evidence. Do not judge from taste alone.
- Recommend backup for shared components, tokens, route shells, and radical changes.
- Never invent metrics, proof, logos, testimonials, users, revenue, uptime, or customer claims.
- Do not replace one generic AI look with another.

## Commands

- `design-surgeon audit --target <route|file|dir|url>`
- `design-surgeon apply --ids <1,2,101> --target <route|file|dir> --backup true|false|ask`
- `design-surgeon verify --target <route|file|dir>`
- `design-surgeon rollback --backup <path>`

Natural language is fine:

```text
Use Design Surgeon to audit /creator/genome. Do not edit. Return numbered top, medium, and radical tables.
```

```text
Apply 1, 2, 5, 103 with backup=true.
```

## Required workflow

1. Load `steps/step-00-router.md`.
2. For audit, load `references/audit-protocol.md`, `references/anti-slop-rubric.md`, `references/product-context-hypestake.md`, `references/browser-playwright-protocol.md`, and `references/output-tables.md`.
3. For apply, load `references/implementation-protocol.md`, `references/backup-rollback-protocol.md`, and `references/verification-gates.md`.
4. For browser/page work, load `references/prompt-injection-threat-model.md`.
5. Use `scripts/hds.mjs` as a deterministic helper when available.

## State to maintain

```text
mode:
target:
url:
audit_report_path:
selected_ids:
backup_mode:
backup_path:
files_read:
files_to_edit:
files_changed:
checks_run:
verification_evidence:
remaining_risks:
```

## Audit output

Use three numbered tables:

- Top Priority Fixes, IDs 1-99.
- Medium Priority Improvements, IDs 101-199.
- Radical Overhaul Options, IDs 201-299.

Close audit with: "No edits made. Pick row IDs to implement."

## Implementation output

Report selected IDs, files changed, verification evidence, remaining risks, and rollback path.
