# Slash Commands

Slash commands are built-in control commands provided by Kimi Code CLI in the interactive TUI, covering account configuration, session management, mode switching, information queries, and more. Type `/` in the input box to trigger command completion — the candidate list filters in real time as you continue typing; command aliases are also matched.

After typing the full command name, press `Enter` to execute. If the `/`-prefixed input does not match any built-in or Skill command, it is sent to the Agent as a regular message.

::: tip
Some commands are only available in the idle state. Executing these commands while a session is streaming output or compacting context will be blocked — press `Esc` or `Ctrl-C` to interrupt first. The "Always available" column in the tables below indicates commands that are also available during streaming.
:::

## Account & Configuration

| Command | Alias | Description | Always available |
| --- | --- | --- | --- |
| `/login` | — | Select an account or platform and log in: Kimi Code uses OAuth device-code flow; Kimi Platform uses API key login | No |
| `/logout` | — | Clear credentials for the currently selected account | No |
| `/provider` | — | Open the interactive provider manager to view, add, refresh, and remove configured providers. See [Platforms & Models — `/provider` and provider management](../configuration/providers.md#provider-—-interactive-provider-management) | Yes |
| `/model` | — | Switch the LLM model used in the current session | Yes |
| `/secondary_model` | — | Configure the secondary model that newly spawned subagents bind to by default (writes the [`[secondary_model]`](../configuration/config-files.md#secondary-model) section and applies to the current session immediately). Requires the `secondary-model` experiment | Yes |
| `/settings` | `/config` | Open the settings panel inside the TUI | Yes |
| `/experiments` | `/experimental` | Open the experimental feature panel | Yes |
| `/permission` | — | Select a permission mode | Yes |
| `/editor` | — | Configure the external editor launched by `Ctrl-G` | Yes |
| `/theme` | — | Switch the terminal UI color theme | Yes |

## Session Management

| Command | Alias | Description | Always available |
| --- | --- | --- | --- |
| `/new` | `/clear` | Start a fresh session, discarding the current context | No |
| `/sessions` | `/resume` | Browse historical sessions and switch to / restore one | No |
| `/tasks` | `/task` | Browse the background task list | Yes |
| `/fork` | — | Fork a new session from the current one, preserving the full conversation history; you stay in the current session | No |
| `/title [<text>]` | `/rename` | Without arguments, display the current session title; with an argument, set a new title (max 200 characters) | Yes |
| `/compact [<instruction>]` | — | Compact the current conversation context to free up token usage; an optional custom instruction can hint to the model what to preserve | No |
| `/undo [<count>]` | — | Undo recent prompts from the active context. Without a count, opens a selector; with a count, undoes that many prompts. Prompts before the last compaction cannot be undone. Undoing also rolls back the todo list and plan mode state produced by those prompts (code changes are not reverted) | No |
| `/reload` | — | Reload the current session and apply the latest `config.toml` settings (providers, models, etc.) and `tui.toml` UI preferences, without restarting the CLI | No |
| `/reload-tui` | — | Reload only the `tui.toml` UI preferences (theme, editor, notifications, etc.) without rebuilding the session | Yes |
| `/init` | — | Analyze the current codebase and generate `AGENTS.md` | No |
| `/export-md [<path>]` | `/export` | Export the current session as a Markdown file | No |
| `/export-debug-zip` | — | Export the current session as a debug ZIP archive (same behavior as [`kimi export`](./kimi-command.md#kimi-export)) | No |
| `/copy` | — | Copy the last assistant message to the clipboard | No |
| `/add-dir [<path>]` | — | Add an extra workspace directory to the current session. Run without a path (or with `list`) to list configured directories. When adding, choose whether to remember the directory for the project in `.kimi-code/local.toml` | No |
| `/web` | — | Open the current session in the web UI: pick a running server to connect to, or start a new foreground server after the TUI exits. See [`kimi web`](./kimi-command.md#kimi-web) | Yes |

## Modes & Run Control

| Command | Alias | Description | Always available |
| --- | --- | --- | --- |
| `/yolo [on\|off]` | `/yes` | Toggle YOLO mode. Without arguments, flips the current state; explicitly passing `on`/`off` forces the setting. When enabled, skips approval for regular tool calls; Plan mode exit approval is not affected | Yes |
| `/auto [on\|off]` | — | Toggle auto permission mode. When enabled, tool approvals are handled automatically and the Agent will not ask the user questions | Yes |
| `/plan [on\|off]` | — | Toggle Plan mode. Without arguments, flips the current state; explicitly passing `on`/`off` forces the setting. Simply toggling does not create an empty plan file | Yes |
| `/plan clear` | — | Clear the current plan | No |
| `/swarm on\|off` | — | Turn swarm mode on or off without sending a prompt. | Yes |
| `/swarm <task>` | — | Turn swarm mode on, then send `<task>` as a normal prompt. If the turn completes normally, swarm mode turns off automatically. In `manual` permission mode, Kimi Code asks whether to switch to `auto` or `yolo` before starting. | No |
| `/goal [...]` | — | Start or manage an autonomous goal | See below |

::: warning
`/yolo` skips approval for regular tool calls. Please make sure you understand the potential risks before enabling it. Plan mode exit approval is not bypassed by `/yolo`; `Bash` inside Plan mode is still subject to the regular `/yolo` allow rules.
:::

## Fusion swarm

Fusion is an experimental, persistent multi-model team in the v2 engine. Enable the `fusion` experiment in `/experiments` or start with `KIMI_CODE_EXPERIMENTAL_FUSION=1`. Configure authorized model aliases before starting; a model name does not provide account access.

```sh
/swarm fusion Implement the retry helper and verify its edge cases
/swarm fusion status
/swarm fusion off
```

Running `/swarm fusion` without a task enables the team without sending a prompt. Choose a strategy when creating the team:

| Command | Strategy |
| --- | --- |
| `/swarm fusion [task]` or `/swarm fusion genius-boss [task]` | Astra leads requirements, scope, consequential decisions, and final acceptance; Opus, the COO and principal engineer, owns technical design, substantive implementation, debugging, and technical review before acceptance; one worker handles bounded mechanics, discovery, and checks. |
| `/swarm fusion idiot-boss [task]` | A coordinator hands coherent implementation chunks to persistent Opus and owns independent verification. Astra provides on-demand critique of consequential plans and final results. |
| `/swarm fusion dual [task]` | Use the default strategy and add a persistent, read-only Muse consultant. |
| `/swarm fusion <strategy> dual [task]` | Add the consultant to either explicit strategy. |
| `/swarm fusion status` | Inspect a bounded team summary, without saved prompts, full mailboxes, or verification-result bodies. May display a compact `claudeSubscription: authenticated | unauthenticated | unavailable` status field (the 3-valued enum itself is unchanged) alongside a sibling `claudeSubscriptionExpired: true` field when expired; tokens and tiers are not persisted in config or team state — only transiently displayed in error text and status feedback. |
| `/swarm fusion off` | Disable the team and restore the session owner's original profile, model, and effort settings. |

The default worker in `genius-boss` is Gemini 3.8 Flash at high effort (fallback: Muse Spark 1.3 at max effort, then GPT-5.6 Terra). The default coordinator in `idiot-boss` is GPT-6 Luna at high effort; its fallback order is `worker_model` (Gemini 3.8 Flash at high effort), then Muse Spark 1.3 at max effort, then GPT-5.6 Terra. Model aliases and effort levels must match the configured catalog; these defaults do not assert live provider availability. See [Fusion model configuration](../configuration/providers.md#fusion-model-configuration).

To assign models interactively, run `/swarm` and select a native Fusion pattern. The first panel becomes **Fusion roles**: choose any configured model and supported effort for each role, and use the dual consultant toggle to add read-only advice. `genius-boss` shows CEO, COO, and worker; `idiot-boss` shows Coordinator, Implementer, and CEO. Unassigned roles use `[fusion]` defaults.

For typed overrides, place `ceo=<alias>[@<effort>]`, `coo=...`, `worker=...`, or `muse=...` after the strategy and optional `dual`, before the task. `worker` selects the coordinator in `idiot-boss` (and without `@<effort>` it uses `coordinator_effort`); `coo` selects its implementer. `muse` assigns the consultant and requires `dual`. Replace `<alias>` with a configured model alias:

```sh
/swarm fusion genius-boss ceo=<alias>@high Implement the retry helper
/swarm fusion idiot-boss dual worker=<alias>@high muse=<alias>@max Review the retry helper
```

Overrides are validated against the configured catalog when the team is created. The team keeps its strategy and role assignments for its lifetime: identical overrides are accepted on reactivation, but different assignments or a different strategy require a new session. Each participant retains its independent context. Model names in the workflow descriptions below refer to the defaults.

`/swarm custom` and `/swarm select` remain separate from native Fusion. Their dialog includes every configured model in a **Session models (AndrewCode)** multi-select; these selections feed the swarm brief, not native role assignments. External CLI provider rows remain separate. Choose **Start** to submit the configured swarm or **Cancel** to close the dialog.

### Script-backed swarm forms

Beyond the native team, `/swarm` can launch script-backed swarm forms that coordinate external CLI agents (Codex, Claude Code, Copilot, OpenCode, Grok, and others) through the bundled Fusion scripts. These forms need `bash` (Git Bash on Windows); `hive`, `graph`, `designer`, `metaloop`, `ultraswarm`, `board`, and `context` also need Python 3. When a form cannot find its scripts, it reports the missing piece instead of failing silently.

- **`/swarm hive <task>`**: nested Hive Board swarm — a lead architect designs the swarm, captains run the signed-in CLIs, and nested workers implement in parallel on a shared board. Options: `--dry-run`, `--captains a,b`, `--children-per-captain N`.
- **`/swarm graph <task>`**: task-graph engineering — run a typed-node DAG with dataflow scheduling and adversarial verification.
- **`/swarm designer <task>`**: emit a custom SwarmSpec (topology catalog or design prompt) from the live roster; it never dispatches.
- **`/swarm metaloop <task>`**: MetaLoop — a strategic planner, an active operator, and parallel workers execute in proposal waves.
- **`/swarm ultraswarm [task]`**: five-agent UltraSwarm council via the bundled `ultraswarm.sh` script. Optional `--dry-run` and `--thinking-effort <level>`.
- **`/swarm board [verb]`**: inspect or post on the Hive Board. Verbs: `init`, `agents` (default), `poll`, `channels`, `tree`, `mentions`. Optional `--db <path>` and leftover text as the task.
- **`/swarm context [list|get|set|clear|snapshot]`**: agency-context store. `list` is the default; `get`/`clear` take a key; `set` takes a key and value.
- **`/swarm council <task>`**: blind independent analysis, then anonymized cross-examination, then a synthesized verdict with a minority report.
- **`/swarm ultracode <verb>`**: run the bundled UltraCode shim locally: `doctor`, `test`, `launch`, `status`, or `install`.
- **`/swarm detect`**: report which external CLI panelists are installed and signed in on this machine.
- **`/swarm dashboard [--port N]`**: start the localhost provider-configuration dashboard and open it in your browser. The server binds to `127.0.0.1` only and requires a per-process token for edits.

The `/swarm` and `/swarm custom` dialogs expose per-form options next to the existing pickers: captain providers, children per captain, layers for the MoA (mixture-of-agents) pattern, a dry-run toggle, the UltraCode verb, board verb, and context action. `/swarm <form> <task>` records these options and starts swarm mode; the assistant then runs the form through the `Fusion` tool (`mode=hive|graph|designer|metaloop|ultraswarm|board|context`) and synthesizes the panelists' output. `/swarm comms` opens the local agent communications board (recent messages under `.andrewcode/comms/`).

Agents exchange a minimal original brief, bounded task packets, and evidence-backed reports rather than copying complete transcripts. The intended workflow batches verification and avoids repeated status polling. Frontier models retain responsibility for judgment- or taste-heavy work instead of blindly delegating it; the default strategy starts with one worker, not an automatic panel for every step.

In `idiot-boss`, each new top-level user turn/task permits at most three implementation handoff packets to the Opus implementer, including packets injected while the implementer is already running. Turning the team off and on, reloading, or system-triggered continuation does not reset this budget or restart model contexts. Once the budget is exhausted, further implementation requires user action; reaching the limit is not success.

The coordinator independently verifies the Opus implementer's work. The implementer may run necessary developer checks, but both roles need not repeat every test. The internal completion step requires recorded successful coordinator tool results after the latest implementation handoff. This records verification evidence, not proof that the implementation is correct; users do not need to run a separate completion command.

Team members can exchange informational messages and broadcasts. In `idiot-boss`, messages to the Opus implementer are saved for its next inbox check: they do not start or inject a model turn, consume or reset the handoff budget, or authorize new implementation. Other modes retain live delivery to running participants.

When the default CEO alias (`gpt-6-astra`) is missing and there is no `ceo` override or custom `ceo_model`, Fusion uses the official Claude Code CLI as a persistent, tool-less CEO decision channel running `claude_model` (default `claude-opus-5-5`), supported by Claude subscription-token import. With `genius-boss`, Opus then hosts the interactive session. The COO must be a configured native model because the tool-less CLI cannot implement. AndrewCode reads Claude Code's official subscription OAuth store (`<CLAUDE_CONFIG_DIR ?? ~/.claude>/.credentials.json`, `claudeAiOauth` block) at runtime to determine subscription authentication state. It never copies, scrapes, or stores access or refresh tokens anywhere: tokens never enter `config.toml`, logs, team state, or status output; only sanitized state (`authenticated`, `subscriptionType`, `rateLimitTier`, `expiry`) is evaluated. Under the reader's deliberate conservative contract, authentication requires both access and refresh tokens to be non-empty; an expired access token still reads as authenticated because the refresh token can renew it. When the access token is expired, remedy text and status append `(access token expired; the CLI will refresh it — re-run andrewcode login claude if that fails.)`. The `~/.claude/.credentials.json` layout is an undocumented on-disk format; if Anthropic changes it, the reader silently degrades to the 'unreadable'/'unauthenticated' states rather than failing loudly, and the remedy stays the same (re-run login). Import completes once the user runs `andrewcode login claude`, which authenticates Claude Code. The sanctioned consumer of the subscription remains the official Claude Code session itself; no undocumented `claude.ai` internal API calls are used, keeping Terms of Service boundaries honest. Preflight validation refuses team creation if the Claude CLI executable is detected but the subscription is unauthenticated (prompting you to run `andrewcode login claude`), unless a non-empty `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` environment variable is set—in which case the CLI authenticates via the API key and fallback proceeds. If the executable is absent, the model-not-configured remedy reports the subscription auth state (`authenticated as <tier>`, `not authenticated — run login`, or `credentials file not found`). The reader distinguishes missing credentials from unreadable ones: a credentials file that exists but cannot be parsed (corrupt or unreadable) produces a distinct remedy — "Claude Code credentials file exists but could not be read (corrupt or unreadable); run `andrewcode login claude` to rewrite it." — instead of the not-found instruction. An explicitly configured custom CEO alias (`ceo_model` or `ceo=<alias>`) that is missing still fails loudly with an error regardless of subscription auth state, rather than silently switching to the CLI. Inspecting the team with `/swarm fusion status` may show a compact `claudeSubscription: authenticated | unauthenticated | unavailable` field (the 3-valued enum itself is unchanged) alongside a sibling `claudeSubscriptionExpired: true` field; tokens and tiers are not persisted in config or team state — only transiently displayed in error text and status feedback. See [Claude authentication](../configuration/providers.md#anthropic) and [Fusion model configuration](../configuration/providers.md#fusion-model-configuration).

::: warning
Persistent conversations make prompt caching possible; they do not guarantee cache hits or a particular cost saving. Provider cache expiry, actual token usage, retries, and review rounds determine the cost. This team has no benchmark-proven intelligence parity or savings percentage. Permission checks still apply, and agent reports are not a substitute for inspecting the changes and running tests.
:::

## Autonomous Goal

`/goal` starts or manages goal mode: a persistent objective that Kimi Code works toward across automatically continuing turns. For usage guidance and examples, see [Goals](../guides/goals.md).

```sh
/goal Update the checkout docs, run docs build, and stop if still blocked after 20 turns
```

| Command | Action | Availability |
| --- | --- | --- |
| `/goal` or `/goal status` | Display the current goal along with its status, elapsed time, turn count, and token count | Always available |
| `/goal pause` | Pause an active goal and keep it | Always available |
| `/goal resume` | Resume a paused or blocked goal | Idle only |
| `/goal cancel` | Remove the current goal | Always available |
| `/goal replace <objective>` | Replace the saved goal with a new objective | Idle only |
| `/goal next <objective>` | Queue an upcoming goal for this session. If no goal is active, start it immediately. The agent does not see queued goals until the current goal completes | Always available |
| `/goal next manage` | Open the upcoming-goal manager. Use <kbd>↑</kbd> / <kbd>↓</kbd> to browse, <kbd>Space</kbd> to select a goal for moving, selected <kbd>↑</kbd> / <kbd>↓</kbd> to reorder it, <kbd>E</kbd> to edit, <kbd>D</kbd> to delete, and <kbd>Esc</kbd> to cancel. In the edit field, use <kbd>Shift-Enter</kbd> or <kbd>Ctrl-J</kbd> for a new line and <kbd>Enter</kbd> to save | Always available |

The words `status`, `pause`, `resume`, `cancel`, `replace`, and `next` act as subcommands only when they are the first word after `/goal`. If your objective needs to start with one of those words, put `--` before it:

```sh
/goal -- cancel the old rollout note after the new docs are published
```

If an upcoming goal needs to start with `manage`, put `--` after `next`:

```sh
/goal next -- manage the release checklist
```

In non-interactive prompt mode, only the create forms start goal mode:

```sh
kimi -p "/goal Fix the failing checkout test"
```

Prompt mode exits with code `0` when the goal completes, `3` when it blocks, and `6` when it pauses. Other `/goal` subcommands, including `next`, are TUI controls and are not handled by `kimi -p`.

## Information & Status

| Command | Alias | Description | Always available |
| --- | --- | --- | --- |
| `/help` | `/h`, `/?` | Show keyboard shortcuts and all available commands | Yes |
| `/btw [question]` | — | Open a side conversation in a forked sub-Agent without affecting the current main Agent turn; without a question, opens the panel first to wait for input | Yes |
| `/usage` | — | Show token usage, context consumption, and quota information | Yes |
| `/status` | — | Show the current session runtime state: version, model, working directory, permission mode, etc. | Yes |
| `/mcp` | — | List MCP servers and their connection status in the current session | Yes |
| `/plugins` | — | Open the interactive plugin manager | Yes |
| `/version` | — | Display the Kimi Code CLI version number | Yes |
| `/feedback` | `/bug` | Submit feedback with optional diagnostic logs and codebase context | Yes |

## Exit

| Command | Alias | Description | Always available |
| --- | --- | --- | --- |
| `/exit` | `/quit`, `/q` | Exit Kimi Code CLI | No |

## Built-in skill commands

Kimi Code CLI ships with a set of built-in Skills that appear directly as `/<name>` slash commands. Unlike external Skills, they do not require the `skill:` prefix and are available out of the box.

| Command | Description |
| --- | --- |
| `/mcp-config` | Configure MCP servers and handle MCP OAuth login. See [MCP](../customization/mcp.md) |
| `/custom-theme [<text>]` | Create or edit a custom TUI color theme. See [Themes](../customization/themes.md) |
| `/update-config` | Inspect or edit `config.toml` (model, provider, permission, hooks) and `tui.toml` (theme, editor, notifications, auto-update) |
| `/check-kimi-code-docs` | Answer Kimi Code product questions (CLI usage, configuration, membership, error codes) against the official docs |
| `/import-from-cc-codex` | Import Claude Code and Codex instructions, skills, and MCP settings into Kimi Code |
| `/sub-skill` | Discover and reorganize the local skill inventory into hierarchical sub-skill bundles. Includes `/sub-skill.review` (read-only proposal) and `/sub-skill.consolidate` (apply the reorganization) |
| `/browser` | Control the user's Chrome/Chromium browser via the `bsk` CLI (navigate, observe, click, fill, screenshot, QA) |

All built-in Skill commands are only available in the idle state.

## Skill Dynamic Commands

Activated external Skills are automatically registered as slash commands. Ordinary external Skills use the `skill:` namespace prefix:

```
/skill:<name> [extra text]
```

For example, `/skill:code-style` loads the Skill named `code-style` and sends it to the Agent; any text appended after the command is concatenated to the Skill prompt.

External sub-skills appear directly in the slash command panel with dotted names:

```
/<parent-skill>.<sub-skill> [extra text]
```

For example, a child Skill named `review` inside a parent Skill named `code-style` is shown as `/code-style.review`. The dotted command name is derived from the hierarchy; the child `SKILL.md` can keep its local `name`.

For convenience, external Skill commands also support a shorthand form that omits the `skill:` prefix — `/<name>` — as long as the name is not taken by a system slash command. That is, `/code-style` falls back to matching `/skill:code-style`.

Built-in Skills shipped with Kimi Code CLI appear directly as `/<name>` in the slash command panel. For example, `/mcp-config` helps configure MCP servers and handle MCP OAuth login, and `/custom-theme [extra text]` invokes the custom-theme workflow to create or edit a TUI theme.

::: info
All Skill commands are only available in the idle state. `flow`-type Skills are also exposed via `/skill:<name>` — there is no separate `/flow:` namespace.
:::

For installing and authoring Skills, see [Agent Skills](../customization/skills.md).

## Next steps

- [Keyboard Shortcuts](./keyboard.md) — Quick reference for TUI keyboard operations
- [Built-in Tools](./tools.md) — Complete reference for tools the Agent can call
