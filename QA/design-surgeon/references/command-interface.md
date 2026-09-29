# Command Interface

Use natural language or command-like prompts.

## Audit

```text
Use Design Surgeon to audit /company/discover. Do not edit.
```

```text
$design-surgeon audit --target src/pages/company/DiscoverPage.tsx --url http://localhost:3000/company/discover --backup ask
```

Audit mode must not edit files. It returns numbered tables.

## Apply

```text
Apply 1, 4, 7, 103 with backup=true.
```

The agent must:

1. Read the previous audit report.
2. Resolve selected row IDs.
3. Identify exact files to touch.
4. Create backup if requested or if risk is medium/high.
5. Implement only selected IDs.
6. Verify and report.

## Verify

```text
Verify the selected changes on desktop and mobile. Re-capture Playwright screenshots if possible.
```

## Rollback

```text
Rollback backup 2026-06-11T210000Z.
```

Rollback restores copied files from `.design-review/deslop/backups/<timestamp>/files/`.

## ID ranges

- `1-99`: Top priority fixes.
- `101-199`: Medium priority improvements.
- `201-299`: Radical overhaul options.

Never silently implement a radical row. The user must explicitly include the ID.
