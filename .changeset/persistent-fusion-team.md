---
"@moonshot-ai/kimi-code": minor
---

Add experimental persistent Fusion teams with two boss strategies, optional read-only consultation, UI role assignment, and command-line model/effort overrides. Support Claude subscription-token import from the official Claude Code credentials store for the tool-less CEO fallback without copying or persisting tokens. The bounded Fusion status view now exposes sanitized Claude subscription state (`claudeSubscription`, `claudeSubscriptionExpired`) without persisting tokens or tiers. Enable `KIMI_CODE_EXPERIMENTAL_FUSION=1`, then run `/swarm fusion <task>` or assign roles in `/swarm`.
