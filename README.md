# Turing

本地运行的多 Agent 编排工具。它把 CLI Agent 和 API Assistant 接到同一个 Web UI、HTTP API 和 SQLite 状态库中，用于分派任务、双 Agent 协作和多步骤工作流。

默认地址：`http://localhost:4590`

## 核心能力

- **Task**：把一个任务交给单个主 Agent 执行。
- **Session**：让两个 Agent 往返协作；人类可以随时插话、暂停、恢复或接管。
- **Workflow**：把多个 Session 串成有依赖关系的步骤；支持模板、并行步骤、人工审核和上游修改后重新执行下游。
- **CLI Agent**：支持 Codex、Claude Code、OpenCode、Gemini CLI。
- **API Assistant**：支持 Anthropic、OpenAI、DeepSeek、智谱和 OpenAI-compatible API。
- **能力约束**：带 `cwd` 的 Task/Session 需要本地 CLI Agent 执行文件读写；API Assistant 可做规划，但不能直接操作本地文件。
- **文件预览**：Workflow 产出的 Markdown、文本、图片和视频可直接在页面中预览。
- **运行恢复**：服务重启后会恢复队列，并将中断的 Session 标记为可恢复状态。

## 安装与启动

```bash
npm install
npm run build
npm start
```

开发验证：

```bash
npm test
```

## Web UI

打开 `http://localhost:4590`：

- `Sessions`：查看双 Agent 对话、插入人工意见、查看每轮输出。
- `Sessions`：错误态可从失败点重试；详情页会显示创建时的 `cwd` 和 `context`。
- `Tasks`：创建单 Agent 任务、查看结果，并可基于人工反馈创建重跑任务。
- `Workflows`：创建和保存工作流模板；按步骤查看产出、预览文件、审核通过或要求修改。
- `Settings`：添加 CLI Agent、API Assistant 和 Provider Key。

本地自用模式默认关闭注册，并允许本机自动登录。

## 配置

配置文件：`~/.turing/config.json`

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
    },
    "opencode": {
      "adapter": "opencode",
      "command": "opencode",
      "args": ["run", "{prompt}"],
      "timeout": 600000
    },
    "gemini-cli": {
      "adapter": "gemini-cli",
      "command": "gemini",
      "args": ["-p", "{prompt}"],
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

也支持环境变量覆盖默认命令：

```bash
TURING_CODEX_COMMAND=/path/to/codex
TURING_CLAUDE_COMMAND=/path/to/claude
TURING_GEMINI_COMMAND=/path/to/gemini
TURING_OPENCODE_COMMAND=/path/to/opencode
```

## 权限模式

Session 和 Workflow Step 支持两种权限模式：

| 模式 | 行为 |
|------|------|
| `safe` | 默认值，不自动绕过 CLI Agent 的权限检查。 |
| `trusted` | 仅用于可信工作流；要求填写 `cwd`，并为支持的 CLI Agent 注入自动放权参数。 |

`trusted` 模式应配合 `policy.allowedWorkspaces` 限制工作目录。

## Agent 能力约束

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

## HTTP API

常用接口：

```text
GET    /health
GET    /api/docs

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
