# AndrewCode

AndrewCode is an independent fork of [Kimi Code](https://github.com/MoonshotAI/kimi-code), the terminal-based AI coding agent from [Moonshot AI](https://www.moonshot.ai/). It builds on Kimi Code and adds AndrewCode-specific branding, provider integrations, and multi-agent orchestration. See the [upstream project](https://github.com/MoonshotAI/kimi-code) for the original project and its history.

The CLI is named `andrewcode`; `kimi` remains available as a compatibility alias. AndrewCode uses its own `~/.andrewcode` data directory by default and does not use `~/.kimi-code` as its runtime home.

## Highlights

- Terminal coding agent and web interface based on Kimi Code.
- Provider and authentication integrations for Kimi, OpenAI Codex, and xAI Grok.
- Several swarm systems, from in-process subagents to nested, multi-CLI swarms.
- `andrewcode` CLI with the `kimi` compatibility alias.

## Agent and swarm systems

AndrewCode includes multiple ways to coordinate agents; they differ in where workers run and how they communicate:

- **`Agent` and `AgentSwarm`** — built-in subagents in the agent engine. `AgentSwarm` launches parallel workers from a shared task template and gathers their results.
- **Native Fusion teams (`/swarm fusion`)** — long-lived, role-based teams. Strategies include `genius-boss`, `idiot-boss`, and `dual` (with a read-only consultant); role/model configuration and lifecycle are managed by the agent engine.
- **Fusion collaboration modes** — `solo`, `panel`, `council`, `debate`, `vote`, and `swarm`. They cover direct answers, parallel model panels, adversarial discussion, voting, and decomposed work.
- **Nested Hive** — an architect-designed hierarchy of CLI captains and AndrewCode child agents sharing a Hive Board.
- **Advanced Fusion swarm forms** — `moa`, `heavy`, `discuss`, `hierarchy`, `flow`, `refine`, `bestof`, `reason` (reflexion, self-consistency, and generated-knowledge prompting), `ladder`, `speclock`, `breaker`, `ballot`, and `gate`.
- **Graph and orchestration forms** — `graph` (task graphs), `kg` (knowledge graphs), `designer` (topology design), `hive` (nested teams), `metaloop` (tiered planning and implementation), `ultraswarm` (multi-agent council), and `board` (shared swarm communication).

Fusion's external CLI orchestration and Python swarm engine are documented in [`fusion/README.md`](fusion/README.md) and [`swarm/README.md`](swarm/README.md). The in-process `AgentSwarm` behavior is described in the [tools reference](docs/en/reference/tools.md); native `/swarm` commands are in the [slash command reference](docs/en/reference/slash-commands.md).

## Quick start

### Prerequisites

- Node.js `>=24.15.0` (see [`.nvmrc`](.nvmrc)).
- pnpm `10.33.0` (see [`package.json`](package.json)).
- Git.

### Build and run from source

From your AndrewCode checkout, install dependencies, build the packages and CLI, then start the development CLI:

```sh
pnpm install
pnpm run build:andrewcode
pnpm dev:cli
```

To install the CLI shims and update your user PATH as well as build, run:

```sh
pnpm run install:andrewcode
```

On Windows, the equivalent wrapper is `install.ps1` from PowerShell:

```powershell
.\install.ps1
```

The installer places the `andrewcode` and `kimi` shims in the AndrewCode home `bin` directory. Open a new terminal after installation, then check:

```sh
andrewcode --version
andrewcode login --status
```

For platform-specific install details and troubleshooting, see [`INSTALL.md`](INSTALL.md).

## Development

This repository is a pnpm monorepo. Common commands:

| Command | Purpose |
|---|---|
| `pnpm dev:cli` | Run the CLI from source. |
| `pnpm run build:andrewcode` | Build packages and the CLI bundle. |
| `pnpm test` | Run the Vitest test suite. |
| `pnpm typecheck` | Build packages and run TypeScript checks. |
| `pnpm lint` | Run Oxlint. |
| `pnpm dev:docs` | Run the documentation site. |

Main directories:

- `apps/kimi-code` — CLI, TUI, and web client.
- `apps/vis` — session replay and debugging visualizer.
- `packages/` — SDK, agent engine, provider, OAuth, and supporting packages.
- `docs/` — English and Chinese user documentation.
- `fusion/` and `swarm/` — Fusion and agent-swarm integrations.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for development and contribution guidance. The user documentation is available in [`docs/en/`](docs/en/) and [`docs/zh/`](docs/zh/).

## Attribution and license

AndrewCode is a fork of [MoonshotAI/Kimi Code](https://github.com/MoonshotAI/kimi-code). Kimi Code is developed by Moonshot AI; this fork retains the upstream project’s applicable notices and license. See [`LICENSE`](LICENSE) for the license text.

AndrewCode changes are maintained in this repository. Please consult the upstream project for upstream contribution policies and support channels; this repository's [`CONTRIBUTING.md`](CONTRIBUTING.md) describes this fork's contribution workflow.
# andrew-code
