# Implementation Protocol

Implementation starts only after the user chooses row IDs.

## Selection rules

- Implement only selected rows.
- Do not opportunistically redesign adjacent areas.
- Do not convert the whole page to a new design system unless a radical row was explicitly selected.
- If a selected row is ambiguous, ask one concise question or propose a safe bounded interpretation.

## Backup rules

Ask or create a backup before editing when:

- `backup=true` was requested.
- A shared component, global CSS, token file, layout shell, nav/sidebar, chart component, or radical row is touched.
- More than three files are likely to change.

Use:

```bash
node scripts/hds.mjs backup --files file1,file2 --target <route> --ids 1,4,101
```

## Edit rules

- Preserve data fetching, auth, role-gating, feature flags, routing, and business logic.
- Prefer token and component variant fixes over one-off raw values.
- Replace generic decoration with product-specific structure.
- Use semantic labels for statuses and charts.
- Do not invent metrics, proof, logos, customer names, testimonials, or claims.
- Keep destructive or external actions out of scope.

## Verification rules

Run available safe checks:

- typecheck
- lint
- relevant tests
- build when practical
- Playwright capture for target route if available
- mobile overflow check
- keyboard/focus check for changed controls

Report what passed, what failed, and what remains uncertain.
