# Backup and Rollback Protocol

Before implementation, ask the user whether to create a backup unless they already specified `backup=true` or `backup=false`.

Default recommendation:

- `backup=true` for shared components, tokens, layouts, route shells, radical rows, or edits touching more than three files.
- `backup=ask` for normal component edits.
- `backup=false` only for tiny local changes when the user accepts risk.

## Create backup

```bash
node scripts/hds.mjs backup --files file1,file2 --target <target> --ids 1,4,101
```

## Rollback

```bash
node scripts/hds.mjs rollback --backup .design-review/deslop/backups/<timestamp>
```

Never use destructive git commands as rollback unless the user explicitly requests them.
