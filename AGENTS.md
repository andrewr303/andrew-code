# AndrewCode Repository Agent Guide

Reply in the same language as the user.

This is **AndrewCode**, the user's personal fork of Kimi Code developed in place on branch `andrewcode` (no separate clone). The user-facing CLI binary is `andrewcode` (with `kimi` compat alias) and runtime home is `~/.andrewcode` (`%USERPROFILE%\.andrewcode` on Windows, configured via `ANDREWCODE_HOME`, never touching `~/.kimi-code`). Internal npm package names remain `@moonshot-ai/*` so the monorepo builds unchanged. Remote `origin` points to upstream `https://github.com/MoonshotAI/kimi-code.git` — **NEVER push to origin**. Keep this root `AGENTS.md` limited to hot-path rules: project map, fork extensions, hard constraints, and workflow requirements.

## Working Principles

- Think from first principles. Start from real requirements, code facts, and verification results; if the goal is unclear, discuss it with the user first.
- Treat code, not documentation, as the source of truth. Unless the user explicitly says otherwise, do not read ordinary Markdown just to understand the implementation.
- Before making code changes, read the relevant code and the most recent constraints, and follow the nearest `AGENTS.md` in the directory tree.
- Keep changes focused. Do not slip in unrelated refactors along the way.
- When committing, do not add any co-author attribution, and do not reveal the identity of the agent in commit messages, PR descriptions, or any explanatory text.
- Never push to remote `origin` or mutate remote repository state without explicit instruction.

## Project Map & AndrewCode Architecture

- `apps/kimi-code`: the AndrewCode CLI / TUI application (`andrewcode` binary, `kimi` alias). Consumes core capabilities through `@moonshot-ai/kimi-code-sdk` and must not depend directly on `@moonshot-ai/agent-core`. When writing or modifying its terminal UI, use the `write-tui` skill (`.agents/skills/write-tui/SKILL.md`).
- **Fusion & Multi-CLI Orchestration**: native multi-model panel orchestrator (`Fusion` tool, `AcpPeer`, `fusion-orchestrate` skill, `packages/agent-core/src/external-cli/`) coordinating external coding CLIs (Codex, Claude Code, Grok, Copilot) and nested swarms (`AgentSwarm`).
- **Evaluator & Long-Running Harness**: fresh-context read-only reviewer (`evaluator` subagent profile) and long-running agent harness (`long-running-harness` skill, Default-FAIL contracts, `PROGRESS.md` handoffs).
- **Build & Install Workflow**: build via `pnpm run build:andrewcode` (packages + CLI bundle); compile and install shims into `~/.andrewcode/bin` via `pnpm run install:andrewcode` (or `.\install.ps1` on Windows / `install.sh` on POSIX).
- **Built-in Retrieval**: codebase search and discovery via `builtin://retrieve` (`packages/agent-core/src/skill/builtin/retrieve.{md,ts}`) prioritizing `rg`, `probe`, and `ast-grep`.
- the browser web UI: source prebuilt into committed assets at `apps/kimi-code/dist-web`, guarded during build by `apps/kimi-code/scripts/check-web-assets.mjs`. To run the server for web/inspector clients, use `pnpm dev:server`.
- `apps/vis`, `apps/vis/server`, `apps/vis/web`: visual debugging tools for sessions and replays.
- `apps/kimi-inspect`: web inspector for the kap-server `/api/v1/debug` RPC surface — workspace/session browser, per-session transcript chat, per-scope Service panels, and DI unit inspection view. See `apps/kimi-inspect/AGENTS.md`.
- `packages/agent-core`: the unified agent engine, including Agent, Session, profile, skills, tools, plan, permission, background, records, in-process DI service layer (`src/services/`), and core capabilities. See `packages/agent-core/AGENTS.md`.
- `packages/agent-core-v2`: the DI × Scope agent engine (v2 port behind kap-server). Four `LifecycleScope` tiers (`App` / `Workspace` / `Session` / `Agent`), L3 unit layer (`Service`/`Fiber` units, collection contribution points, Feature seam in `src/features/`); callers compose `ISessionIndex` → `IWorkspaceLifecycleService.handlerFor`. See `packages/agent-core-v2/AGENTS.md` and use `agent-core-dev` skill.
- `packages/node-sdk`: public TypeScript SDK and harness.
- `packages/kosong`: LLM and provider abstraction layer (supporting Kimi, OpenAI Codex, xAI Grok).
- `packages/kaos`: execution environment and file/process abstractions.
- `packages/oauth`: OAuth and auth utilities for Kimi, Codex, Grok, and Claude integrations.
- `packages/telemetry`: shared client-side telemetry infrastructure.
- `packages/transcript`: isomorphic transcript rendering data layer (L1–L4 architecture, browser-safe, pure TypeScript). See `packages/transcript/AGENTS.md`.
- `packages/kap-server`: server backed by `@moonshot-ai/agent-core-v2`, exposing sessions over REST + WebSocket (`/api/v1` + `/api/v1/ws`) and debug endpoints. See `packages/kap-server/AGENTS.md`.
- `packages/klient`: client SDK contract facade over agent-core-v2 (`@moonshot-ai/klient/ipc|memory`). See `packages/klient/AGENTS.md`.
- `packages/tree-sitter-bash`: pure-TypeScript bash parser (`parse(source, { timeoutMs, maxNodes })`).
- `packages/minidb`: embedded JSON document store behind kap-server's search index. See `packages/minidb/AGENTS.md`.

## Environment Requirements

- **Node.js**: `>=24.15.0` (from root `package.json` `engines`; `.nvmrc` is `24.15.0`, used by nvm / fnm / mise).
- **pnpm**: `10.33.0` (from root `package.json` `packageManager`).
- `pnpm install` will fail when the Node version is not satisfied, because `.npmrc` sets `engine-strict=true`.

## Monorepo Workspace Maintenance

- `pnpm-workspace.yaml` is the source of truth for workspace membership, but `flake.nix` also contains **hardcoded** `workspacePaths` and `workspaceNames` lists.
- **Whenever you add or remove a workspace package, you MUST update both `pnpm-workspace.yaml` and `flake.nix` — for every package, including leaf / test / e2e packages that nothing depends on.**
  - `pnpm-workspace.yaml` uses globs (`packages/*`, `apps/*`), so most packages land there automatically; `flake.nix` is fully manual and is where omissions happen.
  - Missing a path in `flake.nix`'s `workspacePaths` will silently drop files from the Nix build's `src` fileset.
  - Missing a name in `flake.nix`'s `workspaceNames` will break `pnpmConfigHook` because dependencies for that workspace will not be fetched.
- The automated "Check flake.nix workspace sync" (`scripts/check-nix-workspace.mjs`) only validates the transitive dependency **closure of `@moonshot-ai/kimi-code`**. A leaf package outside that closure slips through even when missing from `flake.nix`. Keep it updated by hand on every add/remove.

## General Coding Rules

- For optional object properties, pass `undefined` directly instead of using conditional spread.
  - YES: `{ user }`
  - NO: `{ ...(user ? { user } : undefined) }`
- Optional object properties do not need to additionally allow `undefined` in the type.
  - YES: `interface Options { user?: User }`
  - NO: `interface Options { user?: User | undefined }`
- Internal methods with only a single parameter should not be turned into options objects just for stylistic uniformity.
- Except for a package's `index.ts`, other `index.ts` files should prefer `export * from './module';`.
- Do not add too many new test files. Prefer adding tests to the existing test file of the corresponding component or module.
- When a test fails because of a user modification, default to fixing the test first; do not change the implementation to satisfy an old test unless the implementation truly has a bug.
- Do not sacrifice code quality for external compatibility unless the user explicitly asks for it. Breaking changes go through changesets and a `major` bump, gated by the rule below.

## Experimental Features

- Gate a not-yet-public feature behind an experimental flag. Feature flags use `KIMI_CODE_EXPERIMENTAL_<NAME>` (env-driven, default off) and `KIMI_CODE_EXPERIMENTAL_FLAG` as the master switch (runtime home uses `ANDREWCODE_HOME`; feature flags retain the `KIMI_CODE_EXPERIMENTAL_` prefix). Release by flipping the entry's `default` to `true`.
  - `packages/agent-core` (v1): add the flag to the central registry at `packages/agent-core/src/flags/registry.ts`, then check it with `flags.enabled('my-feature')`.
  - `packages/agent-core-v2` and kap-server modules: declare the flag in the owning domain via `registerFlagDefinition` at import time (see `packages/agent-core-v2/docs/flag.md`), then check it with `IFlagService.enabled(id)`. Current search-index-separation flags: `persistence_minidb_readmodel` and `search_worker`.

## Where to Update Instructions

- Hard rules that affect almost every task: update the root `AGENTS.md`.
- Rules that only affect a specific directory: update the nearest sub-directory `AGENTS.md`.
- Project-map entries stay at 1–2 sentences; deep package docs live in the package's own `AGENTS.md`.
- Keep instruction updates focused and supported by code facts.

## Workflow Requirements

- Follow the codebase retrieval policy (`builtin://retrieve`): prefer `rg` / `rg --files` for exact text and file filtering, `probe` for symbol/concept exploration and definition extraction, and `ast-grep` for structural AST queries with progressive disclosure.
- When designing changes, follow existing boundaries and local patterns first.
- In public text and test data, replace real internal identifiers with neutral placeholders such as `example.com`, `example.test`, and `YOUR_API_KEY`. Before opening a PR, ask a read-only agent to audit the diff for context-specific internal identifiers.
- When creating a PR, the PR title must follow Conventional Commit style, e.g. `chore: remove legacy format commands`.
- When an AI agent opens or updates a PR, fill in `.github/pull_request_template.md` — link the related issue or explain the problem, then describe what changed. Do not leave placeholder text or submit a generic summary of the diff.
- Do not submit vague AI-generated PR text. The human author must understand the change well enough to explain the code, edge cases, and why the approach fits this repository.
- After finishing a task and before submitting a PR, you must run the `gen-changesets` skill (see `.agents/skills/gen-changesets/SKILL.md`) and generate a changeset under `.changeset/` according to its rules.
- When generating a changeset, **never** decide on a `major` bump on your own — stop, explain, and get explicit user confirmation first; default to `minor`, fall back to `patch`. See `.agents/skills/gen-changesets/SKILL.md`.
- Prefer importing via `import ... from '#/...'`, which serves the same purpose as `import ... from '@/...'`.
- Do not commit throwaway scratch or exploratory files. Never stage:
  - Agent working notes or handoff/summary documents (e.g. `HANDOVER-*.md`, `HANDOFF-*.md`, `handoff.md`).
  - Throwaway UI/UX prototypes or design mockups (e.g. `*-designs.html`, `*-mockup.html`, `*-demo(s).html`) at the repo root or under a `design/` folder. The only tracked `.html` files should be Vite `index.html` entrypoints.
  Before committing or opening a PR, run `git status` and `git diff --staged --stat` and remove anything matching these patterns. Put scratch work under `.tmp/` (gitignored) instead of the repo root or the source tree.
