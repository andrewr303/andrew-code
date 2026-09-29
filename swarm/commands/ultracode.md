---
description: Launch or validate the bundled UltraCode-Shim as a Fusion mode, giving Claude Code UltraCode routing over any configured backend.
argument-hint: [doctor|test|launch|status|install]
---

CRITICAL — DIRECT EXECUTION: Immediately dispatch using a *relative* path from the plugin/workspace root. NEVER begin with location searches (`find ~`, `find ~/.claude`, `grep installed_plugins`, broad `ls` of home). These hang on Windows/OneDrive and are not needed. The ultracode/ tree + scripts/ultracode.sh are always here. Use `bash scripts/ultracode.sh $ARGUMENTS`.

Invoke the **fusion-ultracode** skill.

Requested UltraCode action: $ARGUMENTS

Default to `doctor` when no action is given. Use the bundled `ultracode/` checkout through
`scripts/ultracode.sh`; do not modify global Claude settings directly. For setup, run the
offline self-test/doctor first, then tell the user exactly what remains to configure.

For `launch`: `FUSION_ULTRACODE=1 bash scripts/ultracode.sh launch`. Ensure proxy (non-blocking). Report URL. Tell user to invoke standalone `ultracode` (or Windows desktop/Start-UltraCode) from interactive terminal for a full session.
