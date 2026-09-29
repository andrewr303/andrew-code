---
description: UltraSwarm council: select (or accept defaults for) OpenCode + Copilot models, then convene the five-agent council (Claude/Codex/Grok + selected) with discussion first, assignment by Claude, then Claude+Codex integrate.
argument-hint: [task/project brief]
---

CRITICAL — DIRECT EXECUTION: Immediately run model discovery with a *relative* path from the plugin/workspace root. NEVER begin with location searches (`find ~`, `find ~/.claude`, `grep installed_plugins`, broad `ls` of home). These hang on Windows/OneDrive and are not needed. The selector is always at `scripts/ultraswarm_selector.py`. First command:

```
python scripts/ultraswarm_selector.py --discover
```

Invoke the **fusion-ultraswarm** skill.

The skill will:
- Show current OpenCode and Copilot model lists (with live discovery when possible).
- Offer easy defaults: opencode=opencode-go/glm-5.2 , copilot=gemini-3.5-flash
- Let you reply with choices (numbers, ids, or "default") + confirm/override the task.
- Persist the selection non-interactively.
- Then run the real five-agent council (approach discussion → Claude assigns work to all five → workers complete → Claude + Codex integrate + verify).

You can also pass the task directly: /fusion:ultraswarm Build the ... 

If you already have a selection you like, just say the task and the skill will reuse ~/.fusion/ultraswarm/last_selection.json.