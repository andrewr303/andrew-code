# 斜杠命令

斜杠命令是 Kimi Code CLI 在交互式 TUI 中提供的内置控制命令，涵盖账号配置、会话管理、模式切换、信息查询等操作。在输入框中输入 `/` 即可触发命令补全，候选列表随后续字符实时过滤；命令的别名也会一并参与匹配。

输入完整命令名后按 `Enter` 执行。如果输入的 `/` 开头内容不匹配任何内置或 Skill 命令，则按普通消息发送给 Agent。

::: tip 提示
部分命令仅在空闲（idle）状态下可用。会话正在流式输出或压缩上下文时执行这些命令会被拦截，需先按 `Esc` 或 `Ctrl-C` 中断。下表「随时可用」列标注了流式输出期间也可用的命令。
:::

## 账号与配置

| 命令 | 别名 | 说明 | 随时可用 |
| --- | --- | --- | --- |
| `/login` | — | 选择账号或平台并登录：Kimi Code 走 OAuth 验证码流程，Kimi Platform 通过 API 密钥登录 | 否 |
| `/logout` | — | 清除当前所选账号的凭据 | 否 |
| `/provider` | — | 打开交互式供应商管理器，查看、添加、刷新和删除已配置的供应商。详见[平台与模型 — `/provider` 与供应商管理](../configuration/providers.md#provider-—-交互式供应商管理) | 是 |
| `/model` | — | 切换当前会话使用的 LLM 模型 | 是 |
| `/secondary_model` | — | 配置子 Agent 默认绑定的次主力模型（写入 [`[secondary_model]`](../configuration/config-files.md#secondary-model) 配置并在当前会话立即生效）。需开启 `secondary-model` 实验功能 | 是 |
| `/settings` | `/config` | 打开 TUI 内的设置面板 | 是 |
| `/experiments` | `/experimental` | 打开实验功能面板 | 是 |
| `/permission` | — | 选择权限模式 | 是 |
| `/editor` | — | 配置 `Ctrl-G` 调起的外部编辑器 | 是 |
| `/theme` | — | 切换终端 UI 配色主题 | 是 |

## 会话管理

| 命令 | 别名 | 说明 | 随时可用 |
| --- | --- | --- | --- |
| `/new` | `/clear` | 开启全新会话，丢弃当前上下文 | 否 |
| `/sessions` | `/resume` | 浏览历史会话并切换/恢复 | 否 |
| `/tasks` | `/task` | 浏览后台任务列表 | 是 |
| `/fork` | — | 基于当前会话 fork 一份新会话，保留完整对话历史；fork 后仍停留在当前会话 | 否 |
| `/title [<text>]` | `/rename` | 不带参数时显示当前会话标题；带参数时设置为新标题（最长 200 字符） | 是 |
| `/compact [<instruction>]` | — | 压缩当前对话上下文，释放 token 占用；可附带自定义指令，提示模型压缩时保留哪些信息 | 否 |
| `/undo [<count>]` | — | 从当前上下文撤销最近的提示词。不带数量时打开选择器；带数量时撤销对应条数。最后一次上下文压缩之前的提示词不能撤销。撤销会一并回滚这些提示词产生的 todo 列表和计划模式状态（不回滚代码改动） | 否 |
| `/init` | — | 分析当前代码库并生成 `AGENTS.md` | 否 |
| `/export-md [<path>]` | `/export` | 将当前会话导出为 Markdown 文件 | 否 |
| `/export-debug-zip` | — | 将当前会话导出为调试用 ZIP 压缩包（与 [`kimi export`](./kimi-command.md#kimi-export) 行为一致） | 否 |
| `/copy` | — | 将最后一条 AI 回复复制到剪贴板 | 否 |
| `/add-dir [<path>]` | — | 为当前会话添加额外的工作目录。不带路径（或传入 `list`）运行时列出已配置的目录。添加时可选择是否将目录记入项目的 `.kimi-code/local.toml` | 否 |
| `/web` | — | 在 web UI 中打开当前会话：选择一个运行中的实例进行连接，或在 TUI 退出后新开一个前台服务器。参见 [`kimi web`](./kimi-command.md#kimi-web) | 是 |

## 模式与运行控制

| 命令 | 别名 | 说明 | 随时可用 |
| --- | --- | --- | --- |
| `/yolo [on\|off]` | `/yes` | 切换 YOLO 模式。不带参数时翻转；显式传 `on`/`off` 时强制设置。开启后跳过普通工具调用审批；Plan 模式的退出审批不受影响 | 是 |
| `/auto [on\|off]` | — | 切换 auto 权限模式。开启后工具审批自动处理，Agent 不会向用户提问 | 是 |
| `/plan [on\|off]` | — | 切换 Plan 模式。不带参数时翻转；显式传 `on`/`off` 时强制设置。单纯切换不会创建空计划文件 | 是 |
| `/plan clear` | — | 清除当前 plan 方案 | 否 |
| `/swarm on\|off` | — | 开启或关闭 swarm mode，但不发送提示词。 | 是 |
| `/swarm <task>` | — | 先开启 swarm mode，再把 `<task>` 作为普通提示词发送。如果该轮次正常完成，swarm mode 会自动关闭。若当前是 `manual` 权限模式，启动前会提示是否切换到 `auto` 或 `yolo`。 | 否 |
| `/goal [...]` | — | 开始或管理目标模式 | 见下文 |

::: warning 注意
`/yolo` 会跳过普通工具调用的审批确认，使用前请确保了解可能的风险。Plan 模式的退出审批不会被 `/yolo` 跳过；Plan 模式下的 `Bash` 也按 `/yolo` 的普通放行规则处理。
:::

## Fusion swarm

Fusion 是 v2 引擎中的实验性持久多模型团队。请在 `/experiments` 中启用 `fusion` 实验，或启动时设置 `KIMI_CODE_EXPERIMENTAL_FUSION=1`。启动前需要配置已获授权的模型别名；填写模型名称并不会提供账户访问权限。

```sh
/swarm fusion 实现重试辅助函数并验证边界情况
/swarm fusion status
/swarm fusion off
```

不带任务运行 `/swarm fusion` 只会启用团队，不会发送提示词。创建团队时选择策略：

| 命令 | 策略 |
| --- | --- |
| `/swarm fusion [task]` 或 `/swarm fusion genius-boss [task]` | Astra 负责需求、范围、重大决策和最终验收；Opus 作为 COO 和主任工程师，负责技术设计、实质性实现、调试，以及验收前的技术审查；一个执行者处理范围明确的机制、探索和检查。 |
| `/swarm fusion idiot-boss [task]` | 协调者将完整的实现任务块交给持久运行的 Opus，并负责独立验证。Astra 按需审查重要计划和最终结果。 |
| `/swarm fusion dual [task]` | 使用默认策略，并增加一位持久的只读 Muse 顾问。 |
| `/swarm fusion <strategy> dual [task]` | 为显式指定的任一策略增加顾问。 |
| `/swarm fusion status` | 查看有大小限制的团队摘要，不包含已保存的提示词、完整邮箱或验证结果正文。可能显示紧凑的 `claudeSubscription: authenticated | unauthenticated | unavailable` 状态字段（三值枚举本身保持不变），并在 access 令牌过期时附带同级的 `claudeSubscriptionExpired: true` 字段；令牌和费率等级未持久化保存在配置或团队状态中——仅在错误提示和状态反馈中临时显示。 |
| `/swarm fusion off` | 停用团队，并恢复会话所有者原来的 Agent 配置、模型和推理强度设置。 |

`genius-boss` 的默认执行者是 high 推理强度的 Gemini 3.8 Flash（回退顺序为 max 推理强度的 Muse Spark 1.3，然后是 GPT-5.6 Terra）。`idiot-boss` 的默认协调者是 high 推理强度的 GPT-6 Luna；其回退顺序为 `worker_model`（high 推理强度的 Gemini 3.8 Flash），然后是 max 推理强度的 Muse Spark 1.3，再到 GPT-5.6 Terra。模型别名和推理强度必须与已配置的模型目录匹配；这些默认值不代表供应商当前一定提供对应模型。详见 [Fusion 模型配置](../configuration/providers.md#fusion-model-configuration)。

如需交互式分配模型，请运行 `/swarm` 并选择原生 Fusion 模式。第一个面板会切换为 **Fusion roles**：为每个角色选择任意已配置的模型及其支持的推理强度，并通过 dual 顾问开关增加只读建议。`genius-boss` 显示 CEO、COO 和 worker；`idiot-boss` 显示 Coordinator、Implementer 和 CEO。未分配的角色使用 `[fusion]` 默认值。

如需输入覆盖参数，请在策略和可选的 `dual` 之后、任务之前填写 `ceo=<alias>[@<effort>]`、`coo=...`、`worker=...` 或 `muse=...`。在 `idiot-boss` 中，`worker` 选择协调者（未指定 `@<effort>` 时使用 `coordinator_effort`），`coo` 选择实现者。`muse` 分配顾问，必须同时使用 `dual`。请将 `<alias>` 替换为已配置的模型别名：

```sh
/swarm fusion genius-boss ceo=<alias>@high 实现重试辅助函数
/swarm fusion idiot-boss dual worker=<alias>@high muse=<alias>@max 审查重试辅助函数
```

创建团队时，会根据已配置的模型目录验证覆盖参数。团队在整个生命周期中保留其策略和角色分配：重新启用时接受相同的覆盖参数，但不同的角色分配或策略需要新会话。每位参与者保留自己的独立上下文。下文工作流程中的模型名称指默认模型。

`/swarm custom` 和 `/swarm select` 仍与原生 Fusion 相互独立。其对话框在 **Session models (AndrewCode)** 多选区列出所有已配置的模型；选项会写入 swarm 任务说明，而不是原生角色分配。外部 CLI 供应商行仍然独立。选择 **Start** 提交配置好的 swarm，或选择 **Cancel** 关闭对话框。

### 脚本支持的 swarm 形态

除原生团队外，`/swarm` 还可以启动脚本支持的 swarm 形态，通过内置 Fusion 脚本协调外部 CLI Agent（Codex、Claude Code、Copilot、OpenCode、Grok 等）。这些形态需要 `bash`（Windows 下为 Git Bash）；`hive`、`graph`、`designer`、`metaloop`、`ultraswarm`、`board` 和 `context` 还需要 Python 3。当某个形态找不到所需脚本时，它会明确报告缺少的部分，而不是静默失败。

- **`/swarm hive <task>`**：嵌套 Hive Board swarm——首席架构师设计 swarm，captain 驱动已登录的 CLI，嵌套 worker 在共享看板上并行实现。可选参数：`--dry-run`、`--captains a,b`、`--children-per-captain N`。
- **`/swarm graph <task>`**：任务图工程——运行带类型节点的 DAG，支持数据流调度和对抗式验证。
- **`/swarm designer <task>`**：根据当前可用阵容生成自定义 SwarmSpec（拓扑目录或设计提示词），不会真正派发任务。
- **`/swarm metaloop <task>`**：MetaLoop——由战略规划者、活跃操作者和并行 worker 以提案波次执行。
- **`/swarm ultraswarm [task]`**：五 Agent 的 UltraSwarm 评审团，通过内置 `ultraswarm.sh` 运行。可选 `--dry-run` 和 `--thinking-effort <level>`。
- **`/swarm board [verb]`**：查看或向 Hive Board 发帖。动词：`init`、`agents`（默认）、`poll`、`channels`、`tree`、`mentions`。可选 `--db <path>`，其余文本作为任务。
- **`/swarm context [list|get|set|clear|snapshot]`**：agency-context 存储。默认 `list`；`get` / `clear` 需要 key；`set` 需要 key 和 value。
- **`/swarm council <task>`**：先进行盲评式独立分析，再匿名交叉质询，最后给出综合结论与少数派报告。
- **`/swarm ultracode <verb>`**：在本地运行内置的 UltraCode shim：`doctor`、`test`、`launch`、`status` 或 `install`。
- **`/swarm detect`**：报告本机已安装并登录的外部 CLI panelist。
- **`/swarm dashboard [--port N]`**：启动 localhost 供应商配置仪表盘并在浏览器中打开。服务器仅绑定 `127.0.0.1`，修改配置需要进程级 token。

`/swarm` 与 `/swarm custom` 对话框会在原有选择器旁展示各形态的选项：captain 供应商、每位 captain 的子 worker 数量、MoA（mixture-of-agents）模式的层数、dry-run 开关、UltraCode verb、board verb 以及 context action。`/swarm <form> <task>` 会记录这些选项并开启 swarm mode；随后助手会通过 `Fusion` 工具（`mode=hive|graph|designer|metaloop|ultraswarm|board|context`）运行该形态，并综合各位 panelist 的输出。`/swarm comms` 会打开本地 Agent 通信看板（`.andrewcode/comms/` 下的近期消息）。

Agent 交换最小必要的原始任务说明、范围明确的任务包，以及有证据支撑的报告，而不是复制完整的对话记录。预期工作流程会集中执行验证，避免反复轮询状态。需要判断力或审美取舍的工作仍由前沿模型负责，不应盲目委派；默认策略只启动一个执行者，不会在每一步自动调用整个模型评审组。

在 `idiot-boss` 中，每个新的顶层用户轮次或任务最多允许向实现者 Opus 发送三个实现交接包，包括在实现者已运行时注入的交接包。关闭再开启团队、重新加载或系统触发的续跑都不会重置此额度，也不会重新开始模型上下文。额度用尽后，继续实现需要用户操作；达到上限不代表任务成功。

协调者负责独立验证实现者 Opus 的工作。实现者可以运行必要的开发检查，但两个角色不必重复执行所有测试。内部完成步骤要求记录最近一次实现交接之后，协调者实际工具调用的成功结果。这只是记录验证证据，不是证明实现正确；用户无需执行额外的完成命令。

团队成员可以交换信息性消息和广播。在 `idiot-boss` 中，发给实现者 Opus 的消息会保存至其下次检查收件箱时读取：不会启动或注入模型轮次，不会消耗或重置交接额度，也不会授权新的实现工作。其他模式仍会向正在运行的参与者实时投递消息。

当默认 CEO 别名（`gpt-6-astra`）缺失且未配置 `ceo` 覆盖或自定义 `ceo_model` 时，Fusion 使用官方 Claude Code CLI 作为持久、无工具访问权限的 CEO 决策渠道，运行 `claude_model`（默认 `claude-opus-5-5`），并通过 Claude 订阅令牌导入获得支持。在 `genius-boss` 策略下，此时由 Opus 承载交互会话。COO 必须是已配置的原生模型，因为无工具 CLI 无法承担实现工作。AndrewCode 在运行时读取 Claude Code 的官方订阅 OAuth 凭证存储（`<CLAUDE_CONFIG_DIR ?? ~/.claude>/.credentials.json` 中的 `claudeAiOauth` 块）以确定订阅认证状态。它绝不在任何地方复制、抓取或存储 access 或 refresh 令牌：令牌绝不会写入 `config.toml`、日志、团队状态或状态输出，仅使用经过清理的认证状态（`authenticated`、`subscriptionType`、`rateLimitTier`、`expiry`）。读取器遵循审慎的判定契约：必须同时具备非空的 access 和 refresh 令牌才判定为已认证；若 access 令牌过期但 refresh 令牌存在，仍判定为已认证（refresh 令牌可完成续期）。当 access 令牌过期时，解决方案文本与状态输出会追加 `(access token expired; the CLI will refresh it — re-run andrewcode login claude if that fails.)`。`~/.claude/.credentials.json` 的布局属于未公开的磁盘文件格式；如果 Anthropic 对其做出变更，读取器会静默降级为 "unreadable" 或 "unauthenticated" 状态而不会直接崩溃报错，解决方案同样保持不变（重新运行登录）。导入在用户运行 `andrewcode login claude` 完成官方登录后生效。订阅的合规使用者依然是官方 Claude Code 会话本身，不包含任何未公开的 `claude.ai` 内部 API 调用，严格遵守服务条款规范。预检检查会严格把关：若检测到 Claude CLI 可执行文件但订阅尚未认证，Fusion 拒绝创建团队并提示运行 `andrewcode login claude`；但如果环境中存在非空的 `ANTHROPIC_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 环境变量，由于 Claude Code 可以直接通过 API 密钥认证，预检不会拒绝，回退将继续进行并由 CLI 使用该密钥。若可执行文件不存在，缺失模型的解决提示中还会报告订阅认证状态（`authenticated as <tier>`、`not authenticated — run login` 或 `credentials file not found`）。读取器能够区分凭证缺失与不可读取：若凭证文件存在但无法解析（损坏或不可读），会给出独立明确的解决提示——"Claude Code credentials file exists but could not be read (corrupt or unreadable); run `andrewcode login claude` to rewrite it."——而不是文件未找到的提示。如果显式配置了自定义 CEO 别名（通过 `ceo_model` 或 `ceo=<alias>`）但该别名缺失，无论订阅认证状态如何，均会直接报错，绝不会静默切换到 CLI。通过 `/swarm fusion status` 查看团队摘要时，可能显示紧凑的 `claudeSubscription: authenticated | unauthenticated | unavailable` 字段（三值枚举本身保持不变），并在 access 令牌过期时附带同级的 `claudeSubscriptionExpired: true` 字段；令牌和费率等级未持久化保存在配置或团队状态中——仅在错误提示和状态反馈中临时显示。详见 [Claude 认证](../configuration/providers.md#anthropic)与 [Fusion 模型配置](../configuration/providers.md#fusion-model-configuration)。

::: warning 注意
持久会话让提示词缓存成为可能，但不保证缓存命中或特定的成本节省。供应商缓存过期时间、实际 token 用量、重试和审查轮次共同决定成本。该团队尚无基准测试证明其智能水平相当或达到某个节省比例。权限检查仍然生效，Agent 报告不能代替检查修改和运行测试。
:::

## 目标模式

`/goal` 用于开始或管理目标模式：Kimi Code 会在自动续跑的轮次中持续朝一个持久目标工作。使用指导和示例见[使用目标模式](../guides/goals.md)。

```sh
/goal 更新 checkout 文档，运行 docs build，如果 20 轮后仍被阻塞就停止
```

| 命令 | 作用 | 可用性 |
| --- | --- | --- |
| `/goal` 或 `/goal status` | 显示当前目标及其状态、已用时间、轮次数、token 数 | 随时可用 |
| `/goal pause` | 暂停当前的目标，但不删除 | 随时可用 |
| `/goal resume` | 继续被暂停或被阻塞的目标 | 仅空闲时 |
| `/goal cancel` | 移除当前目标 | 随时可用 |
| `/goal replace <objective>` | 用新目标替换已保存的目标 | 仅空闲时 |
| `/goal next <objective>` | 为当前会话安排一个后续目标。如果当前没有目标，则立即开始它。当前目标完成前，Agent 不会看到已排队的目标 | 随时可用 |
| `/goal next manage` | 打开后续目标管理器。用 <kbd>↑</kbd> / <kbd>↓</kbd> 浏览，<kbd>Space</kbd> 选择一个目标以便移动，选中后用 <kbd>↑</kbd> / <kbd>↓</kbd> 调整顺序，<kbd>E</kbd> 编辑，<kbd>D</kbd> 删除，<kbd>Esc</kbd> 取消。编辑输入框中，用 <kbd>Shift-Enter</kbd> 或 <kbd>Ctrl-J</kbd> 添加新行，用 <kbd>Enter</kbd> 保存 | 随时可用 |

`status`、`pause`、`resume`、`cancel`、`replace` 和 `next` 只有作为 `/goal` 后的第一个词时才是子命令。如果你的目标需要以这些词开头，请在目标前加 `--`：

```sh
/goal -- cancel 函数需要在订单失败时返回可重试错误，并补充测试
```

如果后续目标需要以 `manage` 开头，请在 `next` 后加 `--`：

```sh
/goal next -- manage 发布检查清单
```

在非交互式 prompt 模式中，只有创建形式会启动目标模式：

```sh
kimi -p "/goal 修复 checkout 测试失败"
```

Prompt 模式在目标完成时以退出码 `0` 退出，在目标阻塞时以 `3` 退出，在目标暂停时以 `6` 退出。其它 `/goal` 子命令，包括 `next`，都是 TUI 控制命令，不由 `kimi -p` 处理。

## 信息与状态

| 命令 | 别名 | 说明 | 随时可用 |
| --- | --- | --- | --- |
| `/help` | `/h`、`/?` | 显示快捷键和所有可用命令 | 是 |
| `/btw [问题]` | — | 在 fork 出的子 Agent 中打开旁路对话，不改变当前主 Agent 轮次；不带问题时会先打开面板等待输入 | 是 |
| `/usage` | — | 显示 token 用量、上下文占用以及配额信息 | 是 |
| `/status` | — | 显示当前会话运行时状态：版本、模型、工作目录、权限模式等 | 是 |
| `/mcp` | — | 列出当前会话中的 MCP server 及连接状态 | 是 |
| `/plugins` | — | 打开交互式 plugin 管理器 | 是 |
| `/version` | — | 显示 Kimi Code CLI 版本号 | 是 |
| `/feedback` | `/bug` | 提交反馈，可附加诊断日志和代码库上下文 | 是 |

## 退出

| 命令 | 别名 | 说明 | 随时可用 |
| --- | --- | --- | --- |
| `/exit` | `/quit`、`/q` | 退出 Kimi Code CLI | 否 |

## 内置 Skill 命令

Kimi Code CLI 随包内置了一组 Skill，直接以 `/<name>` 形式出现在斜杠命令面板中。与外部 Skill 不同，它们不需要 `skill:` 前缀，开箱即用。

| 命令 | 说明 |
| --- | --- |
| `/mcp-config` | 配置 MCP server 并处理 MCP OAuth 登录。详见 [MCP](../customization/mcp.md) |
| `/custom-theme [<text>]` | 创建或编辑自定义 TUI 配色主题。详见 [主题](../customization/themes.md) |
| `/update-config` | 查看或编辑 `config.toml`（模型、供应商、权限、hooks）和 `tui.toml`（主题、编辑器、通知、自动更新） |
| `/check-kimi-code-docs` | 依据官方文档回答 Kimi Code 产品问题（CLI 用法、配置、会员、错误码） |
| `/import-from-cc-codex` | 从 Claude Code 和 Codex 导入 instructions、skills 和 MCP 设置 |
| `/sub-skill` | 发现并将本地 skill 库存重组为分层子 skill 包。包含 `/sub-skill.review`（只读提案）和 `/sub-skill.consolidate`（执行重组） |
| `/browser` | 通过 `bsk` CLI 控制用户的 Chrome/Chromium 浏览器（导航、观察、点击、填写、截图、QA） |

所有内置 Skill 命令仅在空闲状态下可用。

## Skill 动态命令

已激活的外部 Skill 会自动注册为斜杠命令。普通外部 Skill 以 `skill:` 作为命名空间前缀：

```
/skill:<name> [附加文本]
```

例如 `/skill:code-style` 加载名为 `code-style` 的 Skill 并发送给 Agent；命令后附带的文本拼接到 Skill 提示词之后。

外部子 Skill 会直接以点分名称出现在斜杠命令面板中：

```
/<parent-skill>.<sub-skill> [附加文本]
```

例如，父 Skill 名为 `code-style`，其中子 Skill 的本地名称为 `review`，面板中显示为 `/code-style.review`。点分命令名由层级自动生成，子 Skill 的 `SKILL.md` 可以保留本地 `name`。

为方便输入，外部 Skill 命令同时支持省略 `skill:` 前缀的简写形式 `/<name>`，前提是该名称未被系统斜杠命令占用——即 `/code-style` 会回退匹配到 `/skill:code-style`。

Kimi Code CLI 随包内置的 Skill 会直接以 `/<name>` 形式出现在斜杠命令面板中。例如，`/mcp-config` 用于配置 MCP server 和处理 MCP OAuth 登录，`/custom-theme [附加文本]` 用于进入自定义主题流程，创建或编辑 TUI 主题。

::: info 说明
所有 Skill 命令仅在空闲状态下可用。`flow` 类型的 Skill 同样通过 `/skill:<name>` 暴露，没有独立的 `/flow:` 命名空间。
:::

Skill 的安装与编写详见 [Agent Skills](../customization/skills.md)。

## 下一步

- [键盘快捷键](./keyboard.md) — TUI 键盘操作速查
- [内置工具](./tools.md) — Agent 可调用的工具完整参考
