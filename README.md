# Turing

**开源的多 Agent 编排引擎**：把任意 AI agent（CLI 工具或 API 模型）串成可复用、带人工审核的工作流。

Turing 把 CLI Agent（Codex / Claude Code / Gemini CLI / OpenCode）和 API Assistant（Anthropic / OpenAI / 智谱等）接到同一个 Web UI、HTTP API 和 SQLite 状态库——你用它分派任务、编排双 Agent 协作、或把多步骤任务串成可复用的 Pipeline。

Turing 是 **local-first** 的：默认跑在本机，数据存在 `~/.turing/`，不需要外部服务。引擎内核本身不绑定任何厂商——视频/渲染等外部任务都通过可插拔的 Provider 接入（见 [扩展点](#扩展点external-task-providers)）。

## 快速开始

### 安装与启动

```bash
git clone <repo-url> turing
cd turing
npm install
npm test
npm run build
npm start
```

打开 `http://localhost:4590` 即可使用。

首次任务：

1. 打开 `Settings`，确认至少一个 Local CLI Agent 显示 `ready`，或添加一个 API Assistant。
2. 进入 `Tasks`，选择 Agent，填写一个简单任务。
3. 需要读写文件时填写 `cwd`，该目录必须位于 `policy.allowedWorkspaces` 内；默认只允许当前启动目录。

### 前置条件

- **Node.js 20+**
- 至少一个 CLI Agent（用于需要本地文件读写的任务）：[Codex](https://github.com/openai/codex)、[Claude Code](https://docs.anthropic.com/en/docs/claude-code)、[Gemini CLI](https://github.com/google-gemini/gemini-cli)、[OpenCode](https://github.com/sst/opencode)
- 或者一个 API Provider Key（Anthropic / OpenAI / 智谱等 OpenAI-compatible）用于纯 API 模式

首次启动时，Turing 会：
1. 自动生成 JWT secret 并写入 `~/.turing/config.json`（仅适合 Local Mode）
2. 自动探测本机已安装的 CLI Agent（可在 Settings 页查看）

### 验证

```bash
npm test
```

## 核心能力

- **Task**：把一个任务交给单个主 Agent 执行。
- **Session**：让两个 Agent 往返协作；人类可以随时插话、暂停、恢复或接管。
- **Workflow**：把多个 Session 串成有依赖关系的步骤；支持模板、并行步骤、人工审核和上游修改后重新执行下游。
- **CLI Agent**：支持 Codex、Claude Code、OpenCode、Gemini CLI。
- **API Assistant**：支持 Anthropic、OpenAI、智谱和 OpenAI-compatible API。
- **能力约束**：带 `cwd` 的 Task/Session 需要本地 CLI Agent 执行文件读写；API Assistant 可做规划，但不能直接操作本地文件。
- **文件预览**：Workflow 产出的 Markdown、文本、图片和视频可直接在页面中预览。
- **运行恢复**：服务重启后会恢复队列，并将中断的 Session 标记为可恢复状态。

## Web UI

打开 `http://localhost:4590`：

- `Sessions`：查看双 Agent 对话、插入人工意见、查看每轮输出。
- `Sessions`：错误态可从失败点重试；详情页会显示创建时的 `cwd` 和 `context`。
- `Tasks`：创建单 Agent 任务、查看结果，并可基于人工反馈创建重跑任务。
- `Workflows`：创建和保存工作流模板；按步骤查看产出、预览文件、审核通过或要求修改。
- `Settings`：添加 CLI Agent、API Assistant 和 Provider Key。

本地自用模式默认关闭注册，并允许本机自动登录。

## 配置

配置文件：`~/.turing/config.json`，与默认配置深度合并，只需写要覆盖的部分。服务默认监听 `127.0.0.1`。

示例：

```json
{
  "features": {
    "localCliAgents": true
  },
  "policy": {
    "allowedWorkspaces": [
      "/Users/you/Projects"
    ]
  },
  "agents": {
    "codex": {
      "adapter": "codex",
      "command": "codex",
      "args": ["exec", "--ephemeral", "--skip-git-repo-check", "{prompt}"],
      "timeout": 600000
    },
    "claude-code": {
      "adapter": "claude-code",
      "command": "claude",
      "args": ["-p", "{prompt}", "--output-format", "stream-json", "--verbose"],
      "timeout": 600000
    }
  }
}
```

如果 Claude Code 使用中转站，在对应 Agent 上配置环境变量：

```json
{
  "adapter": "claude-code",
  "command": "claude",
  "env": {
    "ANTHROPIC_BASE_URL": "https://example.com",
    "ANTHROPIC_AUTH_TOKEN": "your-token"
  }
}
```

所有可用的环境变量见 [`.env.example`](./.env.example)。

### 权限模式

Session 和 Workflow Step 支持两种权限模式：

| 模式 | 行为 |
|------|------|
| `safe` | 默认值，不自动绕过 CLI Agent 的权限检查。 |
| `trusted` | 仅用于可信工作流；要求填写 `cwd`，并为支持的 CLI Agent 注入自动放权参数。 |

`trusted` 模式应配合 `policy.allowedWorkspaces` 限制工作目录。详见 [SECURITY.md](./SECURITY.md)。

## Local Mode 与 Server Mode

**Local Mode**：默认模式，只监听 `127.0.0.1`，允许本机自动登录，适合单人本机使用。

**Server Mode**：用于局域网、隧道或公网访问。CLI Agent 是高权限本地进程，远程用户一旦能创建带 `cwd` 的任务，就可能读写允许目录内的文件。

### 暴露到本机之外

Turing 默认只服务 `localhost` 且开启本机自动登录。**如果你要通过 Tailscale、Cloudflare Tunnel、局域网或公网暴露它**，必须：

1. 关闭本地自动登录：`TURING_LOCAL_ACCESS=false`
2. 显式设置 `TURING_JWT_SECRET`
3. 用 `policy.allowedWorkspaces` 限制 CLI Agent 可操作的目录

非 localhost 绑定若缺少这些安全配置，启动会直接失败。

Docker Compose 示例默认只把端口映射到宿主机 `127.0.0.1`，并要求通过环境变量提供强 secret。

### Agent 不可用排查

Settings 里的诊断会归一到这些状态：`not_installed`、`auth_required`、`api_key_missing`、`rate_limited`、`timeout`、`unavailable`。

- `not_installed`：安装对应 CLI，或在 Settings 里填绝对 command 路径，并确认 PATH。
- `auth_required`：在终端手动运行该 CLI 并完成登录；Claude Code 403 常见原因是未登录或订阅不可用。
- `api_key_missing`：添加 Provider Key 或配置 Agent env。
- `rate_limited`：等待额度恢复或更换可用账号/key。
- `timeout` / `unavailable`：检查网络、模型服务、CLI 版本，并适当调大 Agent `timeout`。

### Agent 能力约束

API Assistant 只能通过模型 API 返回文本，不能读取或写入本地项目文件。CLI Agent 由本机进程启动，可以在 `cwd` 指定目录内执行命令和改文件。

因此：

- 创建带 `cwd` 的 Task 时，所选 Agent 必须是本地 CLI Agent。
- 创建带 `cwd` 的 Session 时，Agent B 是执行方，必须是本地 CLI Agent。
- Agent 下拉框会标注 `Filesystem` 或 `No filesystem`。
- 两个 API Assistant 可以讨论、规划、评审；不要用于需要落地改文件的任务。

## 全局 CLI

```bash
npm run build
npm link
```

常用命令：

```bash
turing --help
turing server status
turing agents

turing task create --agent opencode --cwd /path/to/project "执行现有写作工作流"
turing tasks
turing task show <task-id>

turing chat --from codex --to claude-code --cwd /path/to/project "检查并优化这个项目"
turing sessions
turing log <session-id>
turing nudge <session-id> "先停一下，按这个方向修改"
```

CLI 默认连接本机 `http://localhost:4590` 并使用本地登录。远程调用时显式设置：

```bash
TURING_BASE_URL=http://server:4590
TURING_TOKEN=<token>
```

## Workflow

Workflow 是由多个 Session 组成的 Pipeline。每一步可以设置：

- `title`：步骤名称。
- `from` / `to`：协作 Agent。
- `initialPrompt`：该步骤任务。
- `dependsOn`：依赖的上游步骤。
- `approveMode`：执行前是否等待人工批准。
- `permissionMode`：`safe` 或 `trusted`。
- `cwd`：Agent 工作目录。
- `outputDir`：产出保存目录。

示例：

```json
{
  "name": "内容生产",
  "steps": [
    {
      "title": "写初稿",
      "from": { "adapter": "opencode" },
      "to": { "adapter": "claude-code" },
      "initialPrompt": "根据输入完成初稿。",
      "cwd": "/path/to/project",
      "permissionMode": "trusted"
    },
    {
      "title": "人工确认后发布",
      "from": { "adapter": "opencode" },
      "to": { "adapter": "claude-code" },
      "initialPrompt": "基于上一步审核通过的结果执行发布。",
      "dependsOn": [0],
      "approveMode": true,
      "cwd": "/path/to/project",
      "permissionMode": "trusted"
    }
  ]
}
```

`dependsOn` 使用从 `0` 开始的步骤索引。没有依赖的步骤可以并行启动。

## 扩展点：External Task Providers

Turing 引擎内核不绑定任何厂商——任何「提交任务 → 轮询直到完成」的集成（视频生成、渲染、批处理）都通过实现 `ExternalTaskProvider` 接口接入，而不是写死在核心里。一个 Provider 可以：

1. **内联检测**：每轮 agent 输出后，`parseAgentOutput()` 检查是否引用了一个待处理任务（例如 agent 吐出 `submit_id`）。
2. **接管 pipeline 步骤**：`handlePipelineStep()` 完全接管某个 `nodeType` 的步骤（例如 `video_generate`），跳过 adapter 执行循环。

最小示例：

```ts
import type { ExternalTaskProvider } from 'turing'

const myProvider: ExternalTaskProvider = {
  name: 'my-renderer',
  handledNodeTypes: ['render'],
  parseAgentOutput(content) {
    const m = content.match(/render_id:\s*([a-z0-9-]+)/i)
    return m ? { externalId: m[1], downloadDir: './output' } : undefined
  },
  async submit(args, cwd) { /* 调二进制，返回 stdout */ },
  async query(id, dir) { /* 轮询，返回 { status, paths?, errorMessage? } */ },
  pollIntervalMs: 15_000,
  async handlePipelineStep(hooks, sessionId) { /* 读计划、提交、注册任务或完成 */ },
}

router.registerExternalTaskProvider(myProvider)
```

参考实现：`src/examples/dreamina/`（即梦视频流水线，本机入口默认注册）。完整文档见 [docs/EXTERNAL_AGENT_USAGE.md](docs/EXTERNAL_AGENT_USAGE.md#external-task-providers-extending-the-engine)。

## 内置示例 Provider

以下 Provider 需要外部二进制或凭证，默认惰性（未配置时不报错、不参与检测）：

- **Dreamina 视频生成**（`src/examples/dreamina/`）：`video_generate` 工作流步骤需要即梦 CLI。设置 `TURING_DREAMINA_COMMAND` 启用。`src/index.ts` 默认注册它，便于本机直接使用；开源用户如需纯净内核可去掉这行调用。
- **Gemini Image 分镜生成**：`image_generate` 步骤的 Gemini Web 执行器。设置 `TURING_GEMINI_SKILL_SCRIPT` 启用。

未配置时，相关 workflow 步骤会返回明确的配置错误，服务本身正常启动。

## HTTP API

常用接口：

```text
GET    /health
GET    /api/docs
GET    /mcp
POST   /mcp

GET    /api/agents
POST   /api/agents
GET    /api/keys
POST   /api/keys

GET    /api/tasks
POST   /api/tasks
GET    /api/tasks/:id
POST   /api/tasks/:id/stop

GET    /api/sessions
POST   /api/sessions
GET    /api/sessions/:id
POST   /api/sessions/:id/pause
POST   /api/sessions/:id/resume
POST   /api/sessions/:id/confirm
POST   /api/sessions/:id/stop
POST   /api/sessions/:id/message
POST   /api/sessions/:id/nudge

GET    /api/pipelines
POST   /api/pipelines
GET    /api/pipelines/:id
POST   /api/pipelines/:id/pause
POST   /api/pipelines/:id/resume
DELETE /api/pipelines/:id

GET    /api/pipeline-templates
POST   /api/pipeline-templates
DELETE /api/pipeline-templates/:id

POST   /api/files/preview
GET    /api/files/content
```

完整调用示例见 [docs/EXTERNAL_AGENT_USAGE.md](docs/EXTERNAL_AGENT_USAGE.md)。

## MCP / ChatGPT 集成

Turing 提供 Streamable HTTP 风格的 MCP 网关：`POST /mcp`。它使用现有认证，连接端需要传：

```text
Authorization: Bearer <turing token>
```

适合把 ChatGPT 网页当规划 Agent，让它通过 MCP 调用 Turing 去创建、监控和反馈本机 Agent 任务。

当前工具：

- `turing_list_agents`
- `turing_create_task` / `turing_get_task`
- `turing_create_session` / `turing_get_session`
- `turing_create_workflow` / `turing_get_workflow`
- `turing_get_progress`
- `turing_send_feedback`
- `turing_approve_step`
- `turing_retry_step`
- `turing_stop_run`
- `turing_read_artifact`

公网接入 ChatGPT 时，必须使用 HTTPS，并配置稳定的 `TURING_JWT_SECRET` 和 `policy.allowedWorkspaces`。

## 数据保留

数据存储在 `~/.turing/turing.db`。消息默认保留 30 天：

```json
{
  "policy": {
    "messageRetentionMs": 2592000000
  }
}
```

设为 `0` 可关闭消息 GC。

## 贡献

欢迎贡献。开发指南、项目结构和提交规范见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE)
