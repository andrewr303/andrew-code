# Step 00: Router

Parse the user's intent.

- Audit intent: read-only, no edits, numbered tables.
- Apply intent: requires selected row IDs.
- Verify intent: inspect after changes.
- Rollback intent: restore from a backup.

If the user asks for "fix everything" without row IDs, run audit first and return tables.
