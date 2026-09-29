# Native integration in AndrewCode

This directory is the vendored Fusion plugin (scripts, skills, swarm engines).

AndrewCode also ships a **native TypeScript Fusion path**:

- Tool: `Fusion` (agent-core)
- Module: packages/agent-core/src/external-cli/
- Skill: fusion-orchestrate
- Host default: FUSION_HOST=andrewcode
- Login: andrewcode login claude | codex

Prefer the Fusion tool on Windows; bash scripts under scripts/ remain available when bash is present.
See root ANDREWCODE.md.
