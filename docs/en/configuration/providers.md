# Providers and models

Kimi Code CLI supports connecting to multiple LLM platforms simultaneously — one-click login via the Kimi Code managed service, connecting Claude with an Anthropic API key, or connecting third-party inference services via the OpenAI-compatible protocol. Each provider corresponds to a specific API protocol; models are declared on top of providers with their own name, context length, and capabilities. This page explains how to configure each type of provider in `config.toml`.

## Supported provider types

The `type` field in the `providers` table determines which protocol implementation to use:

| Type | Protocol | Typical use |
| --- | --- | --- |
| `kimi` | OpenAI-compatible | Kimi Code managed service, Kimi Platform API key |
| `anthropic` | Anthropic Messages | Claude model family |
| `openai` | OpenAI Chat Completions | OpenAI and compatible services, DeepSeek, Qwen, etc. |
| `openai_responses` | OpenAI Responses API | OpenAI's newer Responses interface |
| `google-genai` | Google GenAI | Gemini API |
| `vertexai` | Google GenAI on Vertex | Google Cloud Vertex AI |

All providers communicate with models in streaming mode by default. Capabilities such as thinking, vision, and tool use are matched automatically by model name prefix — you typically do not need to declare them manually.

**Credential priority**: `api_key` direct field > `[providers.<name>.env]` sub-table key > if both are absent, startup fails with an error. The CLI does not fall back to shell environment variables for credentials — see [Config overrides: provider credentials](./overrides.md#provider-credentials).

## `/provider` — interactive provider management

Prefer not to edit TOML by hand? Type `/provider` in the TUI to open the **provider manager**, where you can interactively add or remove providers.

The manager displays providers as a list of entries grouped by source. Navigation:

- ↑/↓ to move the cursor, ←/→ to page
- `R` to re-query every configured provider and refresh stored model lists
- `d` to delete the current provider (with `[y/N]` confirmation)
- Press Enter on the `[ Add New Platform ]` row to add a new provider

Paths when adding:

- **QwenCloud Token Plan**: pick OpenAI Responses or Anthropic Messages, enter a Token Plan API key (`sk-sp-…`), then the CLI lists models and writes them to `config.toml`. The OpenAI path uses the Responses API so Qwen Harness tools (web search, code interpreter, web scraping, image search) can run on supported models
- **Custom OpenAI-compatible / Anthropic-compatible endpoint**: enter a provider name, base URL, and API key. The CLI queries `/models`, then saves the provider and every listed model to `config.toml`. This is separate from a custom registry (`api.json`)
- **Known third-party provider**: fetches the model catalog from [models.dev](https://models.dev/), select a provider → enter an API key → select a default model. Vendors whose protocol the catalog does not declare (e.g. xai, openrouter, and other vendor-specific SDKs) are imported as OpenAI-compatible with a "guessed" note; when the catalog provides no usable endpoint, a base URL prompt appears first; proprietary protocols (Amazon Bedrock, Cohere) and unrecognized explicit protocols are refused. Deprecated and alpha-status models are excluded from the import list. If the public catalog is unreachable, the CLI falls back to a built-in snapshot of the catalog, so the import still works offline or in blocked networks
- **Custom registry (api.json)**: paste a custom registry URL and Bearer token; the CLI automatically creates the `providers` / `models` entries. On later startup, providers from the same registry URL are refreshed together, so upstream provider additions, removals, and model metadata changes are synced.

::: warning
Kimi Code OAuth managed accounts logged in via `/login` do not appear in `/provider`. Use `/login` and `/logout` to manage them.
:::

The same operations are also available in non-interactive environments via the shell command: [`kimi provider`](../reference/kimi-command.md#kimi-provider).

## `kimi`

For connecting to Moonshot AI's OpenAI-compatible interface, including the Kimi Code managed service and Kimi Platform API keys.

- Default `base_url`: `https://api.moonshot.ai/v1`
- Credential key names: `KIMI_API_KEY`, `KIMI_BASE_URL`
- Additional capability: supports video upload

```toml
[providers.kimi]
type = "kimi"
base_url = "https://api.moonshot.ai/v1"
api_key = "sk-xxxxx"
```

> When using the Kimi Code managed service, running `/login` automatically configures `base_url` and credentials — no manual setup needed.

## `anthropic`

For connecting to the Claude API. Standard Claude models automatically enable vision, tool use, and Thinking (where supported); custom or uncovered models need `capabilities` declared explicitly on `[models.<alias>]`.

An Anthropic API key and a Claude subscription login are separate authentication paths. `andrewcode login claude` starts the official Claude Code login flow. AndrewCode supports Claude subscription-token import by reading Claude Code's official subscription OAuth store (`<CLAUDE_CONFIG_DIR ?? ~/.claude>/.credentials.json`, under the `claudeAiOauth` block) at runtime to determine subscription authentication state. It never copies, scrapes, or stores access or refresh tokens anywhere: tokens never enter `config.toml`, logs, team state, or an `anthropic` API provider. To run Claude directly inside AndrewCode via API, configure an authorized API provider and model alias. The [Fusion swarm](../reference/slash-commands.md#fusion-swarm) can instead resume a persistent, tool-less Claude Code conversation for CEO decision packets when the default CEO (`gpt-6-astra`) is missing; the COO must be a configured native model because the tool-less CLI cannot implement. See [Fusion model configuration](#fusion-model-configuration) for fallback and preflight requirements. The sanctioned consumer of the subscription remains the official Claude Code CLI session itself; no undocumented `claude.ai` internal API calls are used, keeping Terms of Service boundaries honest. That fallback keeps authentication in Claude Code and does not grant model access your account lacks.

- Default `base_url`: follows Anthropic SDK default
- Credential key names: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`
- Default `max_tokens`: inferred per model. To override, set `max_output_size` on the model alias

```toml
[providers.anthropic]
type = "anthropic"
api_key = "sk-ant-xxxxx"

[models."claude-opus-4-7"]
provider = "anthropic"
model = "claude-opus-4-7"
max_context_size = 200000
# max_output_size = 32000  # optional; omit to use the model-inferred default
```

## `openai`

For connecting to the OpenAI Chat Completions protocol, as well as any third-party service compatible with that protocol (override `base_url` as needed).

Third-party reasoning models (DeepSeek, Qwen, One API, etc.) work out of the box: the CLI automatically handles the `reasoning_content` field and `reasoning_effort` injection. If your gateway returns reasoning content under a non-standard field name, set `reasoning_key` on the model alias to override.

- Default `base_url`: `https://api.openai.com/v1`
- Credential key names: `OPENAI_API_KEY`, `OPENAI_BASE_URL`

```toml
[providers.openai]
type = "openai"
base_url = "https://api.openai.com/v1"
api_key = "sk-xxxxx"
```

## `openai_responses`

Corresponds to OpenAI's newer Responses API, always operating in streaming mode. Configuration is the same as `openai`.

- Default `base_url`: `https://api.openai.com/v1`
- Credential key names: `OPENAI_API_KEY`, `OPENAI_BASE_URL`

```toml
[providers.openai-responses]
type = "openai_responses"
base_url = "https://api.openai.com/v1"
api_key = "sk-xxxxx"
```

QwenCloud Token Plan OpenAI uses this type (`/provider` → QwenCloud Token Plan → OpenAI Responses). On supported Qwen models the client also sends hosted Harness tools (`web_search`, `code_interpreter`, `web_extractor`, `web_search_image`, `image_search`).

## `google-genai`

For connecting directly to the Google Gemini API. Thinking, vision, and multimodal capabilities are auto-detected by model name.

- Credential key name: `GOOGLE_API_KEY`

```toml
[providers.gemini]
type = "google-genai"
api_key = "xxxxx"
```

To route through a Gemini-compatible proxy or gateway, set `base_url` (or the `GOOGLE_GEMINI_BASE_URL` env var); when omitted, the SDK default `https://generativelanguage.googleapis.com` is used.

> Give the **host root only**. The Google GenAI SDK appends the API version and path itself (e.g. `/v1beta/models/<model>:generateContent`), so a trailing `/v1beta` would produce a doubled `/v1beta/v1beta/…`.

```toml
[providers.gemini]
type = "google-genai"
api_key = "xxxxx"
base_url = "https://your-gateway.example"
```

## `vertexai`

Shares the same implementation as `google-genai`; setting `type = "vertexai"` switches to the Vertex AI access path.

Authentication follows the standard Google Cloud ADC flow (`gcloud auth application-default login` or a `GOOGLE_APPLICATION_CREDENTIALS` service account JSON) — this part is unrelated to Kimi Code. **The project ID and region must be written in the `[providers.vertexai.env]` sub-table** — simply `export GOOGLE_CLOUD_PROJECT` in the shell will not be read by the CLI.

```toml
[providers.vertexai]
type = "vertexai"

[providers.vertexai.env]
GOOGLE_CLOUD_PROJECT = "my-gcp-project"
GOOGLE_CLOUD_LOCATION = "us-central1"
```

```sh
gcloud auth application-default login   # one-time authentication
kimi
```

To route Vertex requests through a custom (e.g. proxied) endpoint, set `base_url` (or the `GOOGLE_VERTEX_BASE_URL` env var); when omitted, the SDK default regional `*-aiplatform.googleapis.com` host is used. As with `google-genai`, give the host root only — the SDK appends `/v1beta1/publishers/google/models/…` itself.

## OAuth and credential injection

The Kimi Code managed service uses OAuth rather than static API keys. After running `/login`, the built-in authentication toolchain automatically writes and refreshes credentials — no manual configuration is needed in `config.toml` for this.

## Fusion model configuration

The experimental [Fusion swarm](../reference/slash-commands.md#fusion-swarm) selects roles from your configured model catalog. Enable `KIMI_CODE_EXPERIMENTAL_FUSION=1`, then choose a strategy with `/swarm fusion`. The `[fusion]` section maps team roles to model aliases and reasoning effort (how much reasoning the model is asked to use); it does not create providers or credentials.

These are the default native team preferences in `config.toml`. Replace model values with exact aliases from your own catalog where needed, and choose effort levels that those entries declare as supported:

```toml
[fusion]
ceo_model = "gpt-6-astra"
ceo_effort = "xhigh"
coo_model = "claude-opus-5-5"
coo_effort = "xhigh"
coordinator_model = "gpt-6-luna"
coordinator_effort = "high"
worker_model = "gemini-3.8-flash"
worker_effort = "high"
muse_model = "muse-spark-1.3"
muse_effort = "max"
terra_model = "gpt-5.6-terra"
terra_effort = "xhigh"
claude_model = "claude-opus-5-5"
```

- **`ceo_model` / `ceo_effort`:** Astra leadership and final acceptance in `genius-boss`, or on-demand critique in `idiot-boss`.
- **`coo_model` / `coo_effort`:** Opus principal engineer in `genius-boss`, or persistent implementation in `idiot-boss`.
- **`coordinator_model` / `coordinator_effort`:** the `idiot-boss` coordinator.
- **`worker_model` / `worker_effort`:** the `genius-boss` worker (and first coordinator fallback).
- **`muse_model` / `muse_effort`:** the first worker/coordinator fallback and the read-only consultant added by `dual`.
- **`terra_model` / `terra_effort`:** the second worker/coordinator fallback.
- **`claude_model`:** the model used for the official Claude Code CLI fallback when the default CEO is missing (defaults to `claude-opus-5-5`).

For a particular team, override these defaults in the `/swarm` dialog's **Fusion roles** panel or pass role tokens after the strategy, for example `/swarm fusion genius-boss ceo=<alias>@high <task>`. Supported keys are `ceo`, `coo`, `worker`, and `muse`, with optional `@<effort>`; `muse` selects the consultant and requires `dual`. In `idiot-boss`, `worker` is the coordinator (and without `@<effort>` it uses `coordinator_effort`) and `coo` is the implementer. Unassigned roles retain `[fusion]` defaults. Assignments are validated at creation and remain fixed for the team's lifetime: identical overrides may be repeated, but changed assignments require a new session. See [Fusion swarm](../reference/slash-commands.md#fusion-swarm) for dialog and command usage.

Selection checks the configured catalog, not live account entitlements. Ambiguous names and unsupported effort levels are rejected rather than silently selecting a different version or lowering effort. A configured entry can still fail at the provider. Use `/swarm fusion status` (or `fusion status`) to inspect the selected team; it may display a compact `claudeSubscription: authenticated | unauthenticated | unavailable` status field (the 3-valued enum itself is unchanged) alongside a sibling `claudeSubscriptionExpired: true` field when the access token is expired. Tokens and rate tiers are not persisted in config or team state — only transiently displayed in error text and status feedback. Model names alone do not prove availability or cost.

If the default CEO alias (`gpt-6-astra`) is missing and there is no `ceo` override or custom `ceo_model`, Fusion uses the official Claude Code CLI as a persistent, tool-less CEO decision channel running `claude_model` (default `claude-opus-5-5`), supported by Claude subscription-token import. The COO must be a configured native model because the tool-less CLI cannot implement. AndrewCode inspects Claude Code's official subscription OAuth store (`<CLAUDE_CONFIG_DIR ?? ~/.claude>/.credentials.json`, `claudeAiOauth` block) at runtime to determine subscription authentication state. Tokens are never copied, scraped, or stored anywhere: they never enter `config.toml`, logs, team state, or status output. Only sanitized state is evaluated (`authenticated`, `subscriptionType`, `rateLimitTier`, `expiry`). Under the reader's deliberate conservative contract, authentication requires both access and refresh tokens to be non-empty; an expired access token still reads as authenticated because the refresh token can renew it. When the access token is expired, remedy text and status output append `(access token expired; the CLI will refresh it — re-run andrewcode login claude if that fails.)`. The `~/.claude/.credentials.json` layout is an undocumented on-disk format; if Anthropic changes it, the reader silently degrades to the 'unreadable'/'unauthenticated' states rather than failing loudly, and the remedy stays the same (re-run login). If tokens are empty or unauthenticated, import completes once the user runs `andrewcode login claude`, which authenticates Claude Code. The sanctioned consumer of the subscription remains the official Claude Code CLI session itself; no undocumented `claude.ai` internal API calls are shipped or executed, keeping Terms of Service boundaries honest.

Preflight validation enforces strict fallback prerequisites:
- If the official Claude Code executable is found on `PATH` but the subscription is unauthenticated, Fusion refuses to create the team and instructs you to run `andrewcode login claude`. However, an exemption applies if a non-empty `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` environment variable is set: because Claude Code can authenticate directly with API keys without OAuth tokens, fallback proceeds and the CLI uses that key.
- If the executable is absent, the model-not-configured remedy reports current subscription auth state (`authenticated as <tier>`, `not authenticated — run login`, or `credentials file not found`), alongside the standard remedies: configure `[fusion] ceo_model` / pass `ceo=<alias>`, or install Claude Code CLI on `PATH` and authenticate. The reader distinguishes missing credentials from unreadable ones: a credentials file that exists but cannot be parsed (corrupt or unreadable) produces a distinct remedy — "Claude Code credentials file exists but could not be read (corrupt or unreadable); run `andrewcode login claude` to rewrite it." — instead of the not-found instruction.
- If a custom CEO alias is explicitly configured in `[fusion] ceo_model` or via `ceo=<alias>` but is missing from the catalog, team creation fails loudly with an error regardless of subscription authentication state. Explicit custom aliases never silently switch or fall back to the CLI.

The default CEO (`gpt-6-astra`) uses an authorized provider. If the default CEO alias is missing, the fallback requires the official Claude Code executable on `PATH` outside the workspace (`claude.exe` on Windows) and an account authenticated with `andrewcode login claude`. It keeps a separate persistent, tool-less conversation in Claude Code. `claude_model` selects its model and defaults to `claude-opus-5-5`; native `ceo_effort` is not forwarded to the CLI. The COO must be a configured native model because the tool-less CLI cannot implement. Missing-model errors for other roles identify the corresponding config key and role override to use; the Claude CLI fallback applies only to the CEO.

The older `[fusion]` fields `enabled`, `lead_model`, `sidekick_model`, and `routing` configure the legacy lead/sidekick pair, not these native team strategies. `/swarm fusion` does not require `enabled = true`. Select the strategy when creating the team; start a new session to change it without repurposing existing contexts.

Two further `[fusion]` keys tune the [script-backed swarm forms](../reference/slash-commands.md#script-backed-swarm-forms). `scripts_root` points at the Fusion plugin scripts directory (the directory containing `fusion.sh`) and overrides the automatic lookup; the packaged bundle is used when it is unset. `panel_timeout_ms` caps how long each external CLI panelist may run and defaults to `900000`.

## Next steps

- [Configuration files](./config-files.md) — full field reference for the `providers` and `models` tables
- [Config overrides](./overrides.md) — credential resolution priority rules for providers
- [Environment variables](./env-vars.md) — credential key names per provider type
