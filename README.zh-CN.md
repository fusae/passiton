# Passiton

[English](./README.md)

Passiton 是一个本地优先的 CLI Agent 控制台：Task 负责执行，多 Agent Session 负责决策，Workflow 负责编排，并支持人工审核。

![Agent handoff demo: a task fails on one agent and is continued by another, which verifies the workspace and finishes only the remaining work](https://raw.githubusercontent.com/fusae/passiton/main/docs/assets/handoff-demo.gif)

## 核心能力

- **Task / Session / Workflow**：Task 执行具体工作；多人 Session 用于方案竞赛、联合评审、问题会诊和设计讨论；Workflow 用依赖和审批编排两者。
- **UI 或 API 操作**：创建 agents、分派任务、运行 workflows、handoff 失败任务等所有操作，都可在 Web UI 中完成，也可通过 AI operator 能驱动的自描述 HTTP API（`GET /api/docs`）完成。
- **任意 CLI agent**：Claude Code、Codex、Gemini CLI 和 OpenCode 会自动发现、自动配置并自动验证；其他 agent（aider、goose、qwen-code 等）可在 UI 中注册为 custom CLI agent，也可通过 `POST /api/config/agents` 注册。
- **Agent priority**：Settings 中用箭头调整顺序即可设置优先级；未显式指定 agent 的任务会分派给优先级最高的可用 agent。
- **Human-in-the-loop**：暂停、恢复、插入反馈、审批工作流步骤，并在修改上游后重跑下游。
- **Local-first SQLite**：默认监听 `127.0.0.1`，配置和状态保存在 `~/.passiton/`，数据库文件名为兼容保留的 `turing.db`。
- **CLI 与 API agents**：Codex、Claude Code、Gemini CLI、OpenCode、Anthropic、OpenAI、DeepSeek、智谱、Qwen、Moonshot 以及 OpenAI-compatible 端点。
- **Agent handoff**：运行中、失败或停止的任务可交给另一个 ready agent 继续；运行中的任务会先自动停止，并带上上一轮输出尾部和可用的 git 工作区状态。
- **i18n**：界面默认英文，Settings 中可切换简体中文。

## 快速开始

```bash
npx passiton
```

打开 `http://localhost:4590`。

### 从源码运行

```bash
git clone https://github.com/fusae/passiton.git
cd passiton
npm install
npm run build
npm start
```

可选验证：

```bash
npm test
```

本地开发如需链接 `passiton` 命令，可在 `npm run build` 后使用 `npm link`。

## 第一个任务

1. 打开 `Settings`。
2. 观察预置 CLI agents 自行验证：Claude Code、Codex、Gemini CLI 和 OpenCode 会在后台自动发现、自动添加并自动验证。
3. 可用的已安装 CLI 会零点击到达 `ready`。
4. 已安装但不可用的 CLI（例如未登录的 agent）会变为 `invalid`；详情可通过 `Diagnose` 查看。
5. 打开 `Tasks`，输入任务，并按需设置 `cwd`。agent 选择器默认使用 `Auto (highest priority)`，因此无需手动选择 agent。
6. 未被自动发现的 agent 可在 `Settings` → `Agents` → `Add custom agent` 中添加为 custom CLI agent，也可用 `POST /api/config/agents` 和 adapter `custom-cli` 添加；详见 [Community adapters](./docs/community-adapters.md)。

带 `cwd` 的任务需要具备文件系统能力的本地 CLI agent。API assistant 可以规划和评审，但不能直接读写本地文件。

## 多 Agent Session

Session 是决策室，不是执行任务。选择 2–6 个 Ready Agent，为每个 Agent 指定角色，并指定唯一主持人；参与者按轮次发言，最后由主持人输出结构化结论，再交给 Task 或 Workflow 执行。

场景包括：

- `proposal`：各自提出方案，比较后选出方向
- `panel_review`：从产品、技术、风险等角度联合评审
- `diagnosis`：基于证据验证假设并收敛根因
- `design`：讨论架构与产品取舍，形成明确决策

Session 默认只讨论、不写文件；需要改代码、运行命令、测试或提交时使用 Task。

Windows 自定义 Agent 应优先填写 `.exe`、npm 生成的 `.ps1`，或 `node.exe + CLI JavaScript 入口`；Passiton 会把带有同名 `.ps1` 的 `.cmd` 自动切换到 PowerShell shim，避免多行 Prompt 被 `cmd.exe` 拆分。

## 按你的方式驱动：UI 或 API

Passiton 可通过点击 Web UI 操作，也可完全通过自描述 HTTP API 操作；Claude Code、ChatGPT 或任何能发 HTTP 请求的 AI operator 都可以先读取 `GET /api/docs` 再驱动它。

```bash
BASE=http://127.0.0.1:4590
TOKEN="$(curl -s -X POST "$BASE/api/auth/local" | node -pe "JSON.parse(fs.readFileSync(0, 'utf8')).token")"

curl -s "$BASE/api/docs"

curl -s -X POST "$BASE/api/config/agents" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-aider",
    "adapter": "custom-cli",
    "command": "aider",
    "args": ["--message", "{prompt}"],
    "timeout": 600000,
    "env": { "AIDER_MODEL": "sonnet" }
  }'

curl -s -X POST "$BASE/api/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": { "adapter": "my-aider" },
    "prompt": "Summarize this repository."
  }'
```

在 `POST /api/tasks` 中，`agent` 是可选字段；省略时 Passiton 会选择优先级最高的可用 agent。

## 配置

Passiton 读取 `~/.passiton/config.json`，并与 `config/default.json` 合并。已有 `~/.turing/` 安装会继续被识别。

常用环境变量：

| 变量 | 用途 |
| --- | --- |
| `PORT` | HTTP 端口，默认 `4590` |
| `PASSITON_HOST` | 监听地址，默认 `127.0.0.1` |
| `PASSITON_HOME` | `config.json` 和 `turing.db` 的数据目录 |
| `PASSITON_JWT_SECRET` | 暴露或 server mode 下的稳定 JWT secret |
| `PASSITON_ENCRYPTION_KEY` | 加密 provider key 的密钥材料 |
| `PASSITON_LOCAL_ACCESS` | 本地自动登录，默认 `true` |
| `PASSITON_ALLOW_REGISTRATION` | 是否允许注册，默认 `false` |
| `PASSITON_ALLOWED_ORIGINS` | localhost 之外允许的 CORS origin，逗号分隔 |
| `PASSITON_LOCAL_CLI_AGENTS` | 自动发现本地 CLI agents，默认 `true` |
| `PASSITON_ALLOWED_WORKSPACES` | CLI agents 可使用的工作区根目录，按系统路径分隔符分隔 |
| `PASSITON_CODEX_COMMAND` / `PASSITON_CLAUDE_COMMAND` / `PASSITON_GEMINI_COMMAND` / `PASSITON_OPENCODE_COMMAND` | 覆盖 CLI 二进制路径 |
| `PASSITON_DREAMINA_COMMAND` / `PASSITON_GEMINI_SKILL_SCRIPT` | 启用内置实验 provider |

旧版 `TURING_*` 环境变量仍会作为对应 `PASSITON_*` 名称的 fallback。

## 安全模型

Passiton 面向单个可信用户的本地使用场景。默认行为：

- 服务绑定 `127.0.0.1`
- 启用本地自动登录
- 禁用注册
- 首次运行自动生成 JWT 和加密 secret
- CLI agents 作为本地进程运行，可在允许的工作区内操作

如果通过局域网、隧道或公网把 Passiton 暴露到 localhost 之外，启动时要求：

1. `PASSITON_LOCAL_ACCESS=false`
2. `PASSITON_JWT_SECRET` 或 `auth.jwtSecret`
3. 非空的 `policy.allowedWorkspaces`

权限模式：

- `safe`（默认）：用于只读分析、审查和规划。Passiton 不会绕过 CLI agent 的沙箱或审批提示，因此无人值守的文件写入可能失败或等待输入。
- `trusted`：用于需要创建、修改或删除文件，安装依赖，运行构建/测试命令，或创建提交的无人值守任务。它会启用受支持 CLI agent 的自动批准或完全访问参数，因此必须搭配范围明确的 `cwd`。

AI 调用方只要要求涉及文件写入或命令执行，就必须同时传入 `cwd` 和 `permissionMode: "trusted"`。API assistant 无论使用哪种模式都不能访问本地文件。详见 [SECURITY.md](./SECURITY.md)。

## HTTP API

服务为每个 UI 操作都提供 JSON 接口，包括 agents、tasks、sessions、workflows、provider keys、auth tokens、文件预览、日志和统计等。`GET /api/docs` 是自描述参考：

```text
GET /api/docs
```

多数 `/api/*` 接口需要 `Authorization: Bearer <token>`。本地模式可通过 `POST /api/auth/local` 获取 token。

## MCP 集成

Passiton 在 `POST /mcp` 和 `POST /api/mcp` 提供 Streamable HTTP MCP 网关。认证可使用 Bearer token 或 token query 参数。

工具名前缀为 `passiton_*`，包括：

- `passiton_list_agents`
- `passiton_create_task`
- `passiton_get_task_result`
- `passiton_create_session`
- `passiton_send_feedback`
- `passiton_get_progress`
- `passiton_create_workflow`
- `passiton_get_workflow`
- `passiton_approve_step`
- `passiton_retry_step`
- `passiton_stop_run`
- `passiton_read_artifact`

远程 MCP 客户端接入时，请使用 HTTPS，并满足上面的暴露要求。

## External Task Providers

核心 router 不绑定任何厂商。提交远程任务并轮询结果的集成可实现 `src/types.ts` 中的 `ExternalTaskProvider`，并通过 `router.registerExternalTaskProvider(provider)` 注册。

Provider 可以：

- 从 agent 输出中解析外部任务 ID
- 通过 `handledNodeTypes` 接管工作流步骤
- 轮询完成状态并附加输出路径
- 服务重启后恢复轮询

内置示例：

- `src/examples/dreamina/` 中的 Dreamina 视频 provider，通过 `PASSITON_DREAMINA_COMMAND` 启用
- Gemini Image adapter，通过 `PASSITON_GEMINI_SKILL_SCRIPT` 和 `GEMINI_WEB_COOKIE_PATH` 启用

## 数据保留

默认持久化状态位于 `~/.passiton/turing.db`。如果已有 `~/.turing/` 数据，会继续复用。

消息默认保留 30 天，由 `policy.messageRetentionMs` 控制。Provider keys 会加密保存。请像保护本地凭据一样保护数据目录。

## 更多文档

- [HTTP API usage](./docs/EXTERNAL_AGENT_USAGE.md)
- [Community adapters](./docs/community-adapters.md)
- [Contributing](./CONTRIBUTING.md)
- [Security](./SECURITY.md)
