# Verification Gates

Do not call a design pass complete unless:

- Only selected row IDs were implemented.
- A backup was created when requested or warranted by risk.
- The primary workflow still works.
- Existing data fetching, role gating, and routing are preserved.
- Lint/type/test/build commands were run when available and safe.
- Browser capture or manual visual verification covered desktop and mobile.
- Accessibility did not regress.
- No fake proof or unsupported metrics were added.
- The final report lists remaining risks and rollback path.

## Final report format

```md
## Implemented Rows
| ID | What changed | Files | Verification | Risk |

## Evidence
- Before: <audit path>
- After: <screenshot/report path>

## Checks
| Check | Result | Notes |

## Remaining Risks
- ...

## Rollback
- Backup: .design-review/deslop/backups/<timestamp>
- Command: node scripts/hds.mjs rollback --backup <path>
```
