# 平台与模型

Kimi Code CLI 支持同时接入多家 LLM 平台——用 Kimi Code 托管服务一键登录、用 Anthropic API key 接 Claude、用 OpenAI 兼容协议连接第三方推理服务。每个供应商对应一种 API 协议，模型在供应商之上声明自己的名称、上下文长度和能力。本页介绍如何在 `config.toml` 里配置各种供应商。

## 支持的供应商类型

`providers` 表里的 `type` 字段决定使用哪种协议实现：

| 类型 | 协议 | 典型用途 |
| --- | --- | --- |
| `kimi` | OpenAI 兼容 | Kimi Code 托管服务、Kimi Platform API 密钥 |
| `anthropic` | Anthropic Messages | Claude 系列模型 |
| `openai` | OpenAI Chat Completions | OpenAI 及兼容服务、DeepSeek、Qwen 等 |
| `openai_responses` | OpenAI Responses API | OpenAI 较新的 Responses 接口 |
| `google-genai` | Google GenAI | Gemini API |
| `vertexai` | Google GenAI on Vertex | Google Cloud Vertex AI |

所有供应商默认以流式方式与模型交互。thinking、视觉、工具调用等能力按模型名前缀自动匹配，通常不需要手动声明。

**凭证优先级**：`api_key` 直接字段 > `[providers.<name>.env]` 子表键 > 两者都缺时启动报错。CLI 不会从 shell 环境变量自动取凭证——详见[配置覆盖：供应商凭证](./overrides.md#供应商凭证)。

## `/provider` — 交互式供应商管理

不想手动编辑 TOML？在 TUI 里输入 `/provider` 打开**供应商管理器**，可以以交互方式添加或删除供应商。

管理器按来源把供应商显示为一行行条目。操作方式：

- ↑/↓ 移动光标，←/→ 翻页
- `R` 重新查询每个已配置供应商并刷新本地模型列表
- `d` 键删除当前供应商（有 `[y/N]` 确认）
- 在 `[ Add New Platform ]` 行按 Enter 添加新供应商

添加时有这些路径：

- **QwenCloud Token Plan**：选择 OpenAI Responses 或 Anthropic Messages，输入 Token Plan API 密钥（`sk-sp-…`），CLI 会列出模型并写入 `config.toml`。OpenAI 路径走 Responses API，因此支持 Harness 的 Qwen 模型可以自动调用联网搜索、代码解释器、网页抓取和图片搜索
- **Custom OpenAI-compatible / Anthropic-compatible endpoint**：输入供应商名称、base URL 和 API 密钥。CLI 会查询 `/models`，再把供应商和列出的全部模型写入 `config.toml`。这与自定义 registry（`api.json`）不是同一条路径
- **Known third-party provider**：从 [models.dev](https://models.dev/) 拉取模型目录，选供应商 → 输入 API 密钥 → 选默认模型。目录未声明协议类型的供应商（如 xai、openrouter 这类厂商专用 SDK）会按 OpenAI 兼容协议导入并显示 "guessed" 提示；目录没有可用端点时会先弹出 base URL 输入框；Amazon Bedrock / Cohere 等专有协议和无法识别的显式协议会被拒绝导入。已下线（deprecated）和 alpha 状态的模型不会出现在导入列表中。如果公共目录不可达，CLI 会回退到内置目录快照，离线或网络受限环境下也能完成导入
- **Custom registry (api.json)**：粘贴自定义 registry 地址和 Bearer token，CLI 自动创建 `providers` / `models` 条目。后续启动时，同一个 registry 地址下的供应商会一起刷新，因此上游新增、删除供应商以及模型元数据变化都会同步。

::: warning
通过 `/login` 登录的 Kimi Code OAuth 托管账号不会在 `/provider` 里显示，请用 `/login` 和 `/logout` 管理。
:::

非交互环境下也可以用 shell 命令完成同样操作：[`kimi provider`](../reference/kimi-command.md#kimi-provider)。

## `kimi`

用于对接 Moonshot AI 的 OpenAI 兼容接口，包括 Kimi Code 托管服务和 Kimi Platform API 密钥。

- 默认 `base_url`：`https://api.moonshot.ai/v1`
- 凭证键名：`KIMI_API_KEY`、`KIMI_BASE_URL`
- 额外能力：支持视频上传

```toml
[providers.kimi]
type = "kimi"
base_url = "https://api.moonshot.ai/v1"
api_key = "sk-xxxxx"
```

> 使用 Kimi Code 托管服务时，`/login` 登录后会自动配置 `base_url` 和凭证，无需手动填写。

## `anthropic`

用于对接 Claude API。标准 Claude 模型自动启用视觉、工具调用及 Thinking（如支持）；自定义或未覆盖的模型需在 `[models.<alias>]` 里显式声明 `capabilities`。

Anthropic API 密钥和 Claude 订阅登录是两条独立的认证路径。`andrewcode login claude` 会启动官方 Claude Code 登录流程。AndrewCode 支持 Claude 订阅令牌导入，在运行时读取 Claude Code 的官方订阅 OAuth 凭证存储（`<CLAUDE_CONFIG_DIR ?? ~/.claude>/.credentials.json` 中的 `claudeAiOauth` 块）以确定订阅认证状态。它绝不在任何地方复制、抓取或存储 access 或 refresh 令牌：令牌绝不会写入 `config.toml`、日志、团队状态或 `anthropic` API 供应商中。要在 AndrewCode 内直接通过 API 运行 Claude，请配置已获授权的 API 供应商和模型别名。默认 CEO（`gpt-6-astra`）缺失时，[Fusion swarm](../reference/slash-commands.md#fusion-swarm) 可以恢复持久、无工具访问权限的 Claude Code 会话来处理 CEO 决策请求；COO 必须是已配置的原生模型，因为无工具 CLI 无法承担实现工作。回退与预检要求详见 [Fusion 模型配置](#fusion-model-configuration)。订阅的合规使用者依然是官方 Claude Code 会话本身，不包含任何未公开的 `claude.ai` 内部 API 调用，严格遵守服务条款规范。此回退路径将认证保留在 Claude Code 中，不会提供你的账户本来没有的模型访问权限。

- 默认 `base_url`：跟随 Anthropic SDK 默认值
- 凭证键名：`ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL`
- 默认 `max_tokens`：按模型自动推断。如需覆盖，在模型别名上设 `max_output_size`

```toml
[providers.anthropic]
type = "anthropic"
api_key = "sk-ant-xxxxx"

[models."claude-opus-4-7"]
provider = "anthropic"
model = "claude-opus-4-7"
max_context_size = 200000
# max_output_size = 32000  # 可选，省略时使用模型推断的默认值
```

## `openai`

用于对接 OpenAI Chat Completions 协议，也可连接任何兼容该协议的第三方服务（覆盖 `base_url` 即可）。

第三方推理模型（DeepSeek、Qwen、One API 等）开箱即用：CLI 自动处理 `reasoning_content` 字段和 `reasoning_effort` 注入。如果你的网关用非标准字段名返回推理内容，在模型别名上设 `reasoning_key` 覆盖。

- 默认 `base_url`：`https://api.openai.com/v1`
- 凭证键名：`OPENAI_API_KEY`、`OPENAI_BASE_URL`

```toml
[providers.openai]
type = "openai"
base_url = "https://api.openai.com/v1"
api_key = "sk-xxxxx"
```

## `openai_responses`

对应 OpenAI 较新的 Responses API，始终以流式方式工作。配置方式与 `openai` 相同。

- 默认 `base_url`：`https://api.openai.com/v1`
- 凭证键名：`OPENAI_API_KEY`、`OPENAI_BASE_URL`

```toml
[providers.openai-responses]
type = "openai_responses"
base_url = "https://api.openai.com/v1"
api_key = "sk-xxxxx"
```

QwenCloud Token Plan 的 OpenAI 路径使用该类型（`/provider` → QwenCloud Token Plan → OpenAI Responses）。在支持 Harness 的 Qwen 模型上，客户端还会发送托管工具（`web_search`、`code_interpreter`、`web_extractor`、`web_search_image`、`image_search`）。

## `google-genai`

用于直连 Google Gemini API。thinking、视觉及多模态能力按模型名自动识别。

- 凭证键名：`GOOGLE_API_KEY`

```toml
[providers.gemini]
type = "google-genai"
api_key = "xxxxx"
```

如需经由兼容 Gemini 协议的代理/网关访问，可设置 `base_url`（或 `GOOGLE_GEMINI_BASE_URL` 环境变量）；不填时使用 SDK 默认地址 `https://generativelanguage.googleapis.com`。

> 只填**主机根地址**。Google GenAI SDK 会自行追加 API 版本与路径（如 `/v1beta/models/<model>:generateContent`），所以结尾带 `/v1beta` 会导致路径重复成 `/v1beta/v1beta/…`。

```toml
[providers.gemini]
type = "google-genai"
api_key = "xxxxx"
base_url = "https://your-gateway.example"
```

## `vertexai`

与 `google-genai` 共用实现，`type = "vertexai"` 时切换到 Vertex AI 访问路径。

认证走 Google Cloud 标准 ADC 流程（`gcloud auth application-default login` 或 `GOOGLE_APPLICATION_CREDENTIALS` 服务账号 JSON），这部分与 Kimi Code 无关。**项目 ID 和区域必须写在 `[providers.vertexai.env]` 子表里**——直接在 shell 里 `export GOOGLE_CLOUD_PROJECT` 不会被 CLI 读取。

```toml
[providers.vertexai]
type = "vertexai"

[providers.vertexai.env]
GOOGLE_CLOUD_PROJECT = "my-gcp-project"
GOOGLE_CLOUD_LOCATION = "us-central1"
```

```sh
gcloud auth application-default login   # 一次性完成认证
kimi
```

如需让 Vertex 请求走自定义（如代理）端点，可设置 `base_url`（或 `GOOGLE_VERTEX_BASE_URL` 环境变量）；不填时使用 SDK 默认的区域化 `*-aiplatform.googleapis.com` 地址。与 `google-genai` 一样，只填主机根地址——SDK 会自行追加 `/v1beta1/publishers/google/models/…`。

## OAuth 与凭证注入

Kimi Code 托管服务使用 OAuth 而非静态 API 密钥。运行 `/login` 后，内置的认证工具链会自动写入并刷新凭证，`config.toml` 里无需手动配置这部分内容。

## Fusion 模型配置 {#fusion-model-configuration}

实验性 [Fusion swarm](../reference/slash-commands.md#fusion-swarm) 从已配置的模型目录中选择角色。请启用 `KIMI_CODE_EXPERIMENTAL_FUSION=1`，然后通过 `/swarm fusion` 选择策略。`[fusion]` 配置节将团队角色映射到模型别名和推理强度（要求模型投入多少推理）；它不会创建供应商或凭证。

以下是 `config.toml` 中的原生团队默认配置。请按需将模型值替换为你自己的模型目录中的精确别名，并选择对应条目声明支持的推理强度：

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

- **`ceo_model` / `ceo_effort`：**Astra 在 `genius-boss` 中负责领导和最终验收，在 `idiot-boss` 中按需提供评审。
- **`coo_model` / `coo_effort`：**Opus 在 `genius-boss` 中作为主任工程师，在 `idiot-boss` 中持续承担实现工作。
- **`coordinator_model` / `coordinator_effort`：**`idiot-boss` 中的协调者。
- **`worker_model` / `worker_effort`：**`genius-boss` 中的执行者（以及协调者的第一回退选择）。
- **`muse_model` / `muse_effort`：**执行者或协调者的第一回退选择，以及 `dual` 增加的只读顾问。
- **`terra_model` / `terra_effort`：**执行者或协调者的第二回退选择。
- **`claude_model`：**默认 CEO 缺失时用于官方 Claude Code CLI 回退的模型（默认 `claude-opus-5-5`）。

如需为某个团队覆盖这些默认值，可在 `/swarm` 对话框的 **Fusion roles** 面板中分配角色，或在策略之后传入角色参数，例如 `/swarm fusion genius-boss ceo=<alias>@high <task>`。支持的键为 `ceo`、`coo`、`worker` 和 `muse`，可选填 `@<effort>`；`muse` 选择顾问，必须同时使用 `dual`。在 `idiot-boss` 中，`worker` 选择协调者（未指定 `@<effort>` 时使用 `coordinator_effort`），`coo` 是实现者。未分配的角色保留 `[fusion]` 默认值。角色分配在创建时验证，并在团队整个生命周期中固定：可以重复传入相同的覆盖参数，但更改分配需要新会话。对话框及命令用法详见 [Fusion swarm](../reference/slash-commands.md#fusion-swarm)。

选择过程检查已配置的模型目录，而不是实时账户授权。有歧义的名称和不受支持的推理强度会被拒绝，不会静默选择另一版本或降低推理强度。已配置的条目仍可能被供应商拒绝。使用 `/swarm fusion status`（或 `fusion status`）查看选定的团队；输出中可能包含紧凑的 `claudeSubscription: authenticated | unauthenticated | unavailable` 状态字段（三值枚举本身保持不变），并在 access 令牌过期时附带同级的 `claudeSubscriptionExpired: true` 字段。令牌或费率等级未持久化保存在配置或团队状态中——仅在错误提示和状态反馈中临时显示。仅凭模型名称无法证明可用性或成本。

如果默认 CEO 别名（`gpt-6-astra`）缺失且未配置 `ceo` 覆盖或自定义 `ceo_model`，Fusion 会使用官方 Claude Code CLI 作为持久、无工具访问权限的 CEO 决策渠道，运行 `claude_model`（默认 `claude-opus-5-5`），并通过 Claude 订阅令牌导入获得支持。COO 必须是已配置的原生模型，因为无工具 CLI 无法承担实现工作。AndrewCode 在运行时读取 Claude Code 的官方订阅 OAuth 凭证存储（`<CLAUDE_CONFIG_DIR ?? ~/.claude>/.credentials.json` 中的 `claudeAiOauth` 块）以确定订阅认证状态。令牌绝不会被复制、抓取或存储在任何地方：绝不进入 `config.toml`、日志、团队状态或状态输出。系统仅使用经过清理的状态信息（`authenticated`、`subscriptionType`、`rateLimitTier`、`expiry`）。读取器遵循审慎的判定契约：必须同时具备非空的 access 和 refresh 令牌才判定为已认证；若 access 令牌过期但 refresh 令牌存在，仍判定为已认证（refresh 令牌可完成续期）。当 access 令牌过期时，解决方案文本与状态输出会追加 `(access token expired; the CLI will refresh it — re-run andrewcode login claude if that fails.)`。`~/.claude/.credentials.json` 的布局属于未公开的磁盘文件格式；如果 Anthropic 对其做出变更，读取器会静默降级为 "unreadable" 或 "unauthenticated" 状态而不会直接崩溃报错，解决方案同样保持不变（重新运行登录）。如果凭证文件为空或尚未认证，用户运行 `andrewcode login claude` 完成官方登录后导入即告完成。订阅的合规使用者依然是官方 Claude Code CLI 会话本身，不包含任何未公开的 `claude.ai` 内部 API 调用，严格遵守服务条款规范。

预检验证执行严格的回退前置条件：
- 若在 `PATH` 中检测到官方 Claude Code 可执行文件但订阅尚未认证，Fusion 默认拒绝创建团队并提示运行 `andrewcode login claude`。但该限制存在例外规则：若环境中已配置非空的 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 环境变量，由于 Claude Code 无需 OAuth 令牌即可直接通过 API 密钥认证，因此预检不会拒绝，回退正常进行且 CLI 会直接使用该密钥。
- 若可执行文件不存在，缺失模型的解决提示中还会报告当前的订阅认证状态（`authenticated as <tier>`、`not authenticated — run login` 或 `credentials file not found`），并附带标准解决建议：配置 `[fusion] ceo_model` / 传入 `ceo=<alias>`，或将 Claude Code CLI 安装到 `PATH` 并完成登录。读取器能够区分凭证缺失与不可读取：若凭证文件存在但无法解析（损坏或不可读），会给出独立明确的解决提示——"Claude Code credentials file exists but could not be read (corrupt or unreadable); run `andrewcode login claude` to rewrite it."——而不是文件未找到的提示。
- 若在 `[fusion] ceo_model` 中显式配置或通过 `ceo=<alias>` 传入了自定义 CEO 别名，但该别名在模型目录中缺失，无论订阅认证状态如何，均会直接报错。显式自定义别名绝不会静默切换或回退到 CLI。

默认 CEO（`gpt-6-astra`）使用已获授权的供应商。如果默认 CEO 别名缺失，回退路径要求官方 Claude Code 可执行文件位于工作区之外的 `PATH` 目录中（Windows 上为 `claude.exe`），并已通过 `andrewcode login claude` 完成账户认证。它在 Claude Code 中保留独立、持久且无工具访问权限的会话。`claude_model` 选择该会话的模型，默认值为 `claude-opus-5-5`；原生 `ceo_effort` 不会传给 CLI。COO 必须是已配置的原生模型，因为无工具 CLI 无法承担实现工作。其他角色的模型缺失错误会指出对应的配置键和角色覆盖参数；Claude CLI 回退仅适用于 CEO。

原有的 `[fusion]` 字段 `enabled`、`lead_model`、`sidekick_model` 和 `routing` 配置的是旧版主 Agent 与 sidekick 配对，而不是这些原生团队策略。`/swarm fusion` 不要求设置 `enabled = true`。请在创建团队时选择策略；如需更换策略，请开启新会话，以免改变现有上下文的用途。

另外两个 `[fusion]` 字段用于调整[脚本支持的 swarm 形态](../reference/slash-commands.md#脚本支持的-swarm-形态)。`scripts_root` 指向 Fusion 插件脚本目录（即包含 `fusion.sh` 的目录），用于覆盖自动查找；未设置时使用随包内置的脚本。`panel_timeout_ms` 限制每个外部 CLI panelist 的最长运行时间，默认 `900000`。

## 下一步

- [配置文件](./config-files.md) — `providers` 和 `models` 表的完整字段参考
- [配置覆盖](./overrides.md) — 供应商凭证的解析优先级规则
- [环境变量](./env-vars.md) — 各供应商对应的凭证键名列表
