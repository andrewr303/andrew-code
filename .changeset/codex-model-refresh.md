---
"@moonshot-ai/kimi-code": minor
---

Refresh Codex models from the live backend. `andrewcode provider refresh` (and the TUI `/provider` refresh) now re-pings the ChatGPT Codex catalog, so new models like `gpt-6-sol` appear without a full re-login; `andrewcode provider refresh codex` refreshes just Codex. Codex logins also force a live catalog fetch instead of replaying the 5-minute on-disk cache, and the default Codex client version is bumped to 0.156.0 so version-gated models are visible.
