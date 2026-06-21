# Turing — 产品文档

## 这是什么

Turing 是一个本地运行的 **AI Agent 通信代理**。它让任意两个 AI agent 像跟人聊天一样互相对话，agent 不需要任何改造，也不知道对面是人还是机器。

你（人类）可以随时旁观、插话、接管对话。

## 目前支持的 Agent

| 名称 | 说明 |
|------|------|
| **codex** | OpenAI Codex（本机 App） |
| **claude-code** | Anthropic Claude Code CLI |
| **gemini-cli** | Google Gemini CLI |
| **opencode** | OpenCode（支持 GLM、GPT 等多模型） |

此外支持通过 API 接入 Anthropic、OpenAI、DeepSeek、智谱等模型作为 Assistant。

## 怎么用

### 启动

```bash
# 在项目根目录
npm install
npm run build
npm start
```

Server 跑在 `http://localhost:4590`。

### Web UI

浏览器打开 `http://localhost:4590`，可以：
- 看所有对话 session
- 实时查看消息
- 创建新 session
- 人类插入（暂停 / 发消息 / 继续）

### 通过 CLI

安装 `turing` 命令后，可直接通过命令行创建任务、查看会话：

```bash
turing --help
turing task create --agent opencode --cwd /path/to/project "执行写作工作流"
turing chat --from codex --to claude-code --cwd /path/to/project "检查并优化这个项目"
turing sessions
turing log <session-id>
```

---

## HTTP API

Base URL: `http://localhost:4590`

所有请求和响应都是 JSON。`/api/*` 接口需要 Bearer token 鉴权。

---

### 1. 查看可用 Agent

```
GET /api/agents
```

**返回**：
```json
[
  { "name": "codex", "healthy": true },
  { "name": "claude-code", "healthy": true },
  { "name": "opencode", "healthy": true }
]
```

`healthy` 表示这个 agent 当前能不能用（网络通不通、CLI 存不存在）。

---

### 2. 创建 Task

```
POST /api/tasks
```

**请求体**：
```json
{
  "agent": { "adapter": "opencode", "label": "OpenCode" },
  "prompt": "把这条推荐写成一篇公众号文章",
  "context": {
    "rules": "按既定写文规程执行",
    "text": "推荐标题、摘要、原文链接、建议角度"
  },
  "cwd": "/path/to/project"
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `agent.adapter` | ✅ | 负责接单和调度的主 agent 名称 |
| `prompt` | ✅ | 任务内容 |
| `agent.label` | ❌ | 显示用名称 |
| `context.files` | ❌ | 文件路径列表，创建任务时读取并注入 |
| `context.rules` | ❌ | 约束 / 规则文本 |
| `context.text` | ❌ | 背景信息 |
| `cwd` | ❌ | agent 工作目录（需要本地 CLI agent） |
| `systemPrompt` | ❌ | 覆盖默认任务系统提示 |

**返回**：创建好的 task 对象，初始状态为 `queued`。

### 3. 查看 Task

```
GET /api/tasks
GET /api/tasks/:id
GET /api/tasks?status=done
POST /api/tasks/:id/stop
```

状态：`queued` / `running` / `done` / `error` / `stopped`。  
完成后，`output` 是完整输出，`result` 是 `[RESULT]...[/RESULT]` 中提取出的最终结果。

---

### 4. 创建对话 Session

```
POST /api/sessions
```

**请求体**：
```json
{
  "from": { "adapter": "codex", "label": "Codex" },
  "to": { "adapter": "opencode", "label": "OpenCode" },
  "initialPrompt": "帮我写一个 hello world 脚本",
  "context": {
    "files": ["src/web/app.js", "src/web/style.css"],
    "rules": "vanilla JS, dark theme, no frameworks",
    "text": "Any free-form background text"
  },
  "cwd": "/tmp",
  "maxRounds": 5,
  "approveMode": false
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `from.adapter` | ✅ | 发起方 agent 名称 |
| `to.adapter` | ✅ | 接收方 agent 名称 |
| `initialPrompt` | ✅ | 第一条消息内容 |
| `from.label` / `to.label` | ❌ | 显示用的名字，不填就用 adapter 名 |
| `context.files` | ❌ | 文件路径列表。创建 session 时会读取内容并缓存，后续每轮都注入给 agent |
| `context.rules` | ❌ | 约束 / 规则文本 |
| `context.text` | ❌ | 自由背景说明 |
| `cwd` | ❌ | agent 的工作目录，默认当前目录（需要本地 CLI agent） |
| `maxRounds` | ❌ | 最大对话轮数，默认 20 |
| `approveMode` | ❌ | 是否每轮需要人类审批，默认 false |

**返回**：创建好的 session 对象。对话会自动开始跑。

**流程**：`from` agent 先收到 `initialPrompt`，回复后传给 `to` agent，`to` 回复再传回 `from`……如此往复，直到达到 `maxRounds` 或被手动停止。

**Context 注入示例**：

```json
{
  "from": { "adapter": "codex" },
  "to": { "adapter": "claude-code" },
  "initialPrompt": "重构这个页面",
  "cwd": "/path/to/project",
  "context": {
    "files": ["src/web/app.js", "src/web/style.css"],
    "rules": "vanilla JS, dark theme, no frameworks",
    "text": "保留现有功能，不要引入构建工具"
  }
}
```

`context` 会在创建 session 时读取文件并缓存，然后作为系统级上下文在每一轮都注入给两个 agent。

---

### 5. 查看所有 Session

```
GET /api/sessions
GET /api/sessions?status=active
```

| 参数 | 说明 |
|------|------|
| `status` | 可选，筛选状态：`active` / `paused` / `done` / `error` / `stopped` |

**返回**：session 列表（不含消息内容）。

---

### 6. 查看单个 Session（含消息）

```
GET /api/sessions/:id
```

**返回**：session 详情 + 全部消息记录。

```json
{
  "id": "3571fcc7-...",
  "from": { "adapter": "claude-code", "label": "Claude" },
  "to": { "adapter": "opencode", "label": "OpenCode" },
  "status": "active",
  "currentRound": 3,
  "maxRounds": 20,
  "messages": [
    {
      "id": "f970857a-...",
      "from": "human",
      "content": "创建一个文件...",
      "round": 0,
      "timestamp": 1776944953314
    },
    {
      "id": "604e445e-...",
      "from": "opencode",
      "content": "文件已创建...",
      "round": 1,
      "timestamp": 1776944985990
    }
  ]
}
```

---

### 7. 暂停对话

```
POST /api/sessions/:id/pause
```

暂停后 agent 不再自动对话。你可以插入消息后再继续。

---

### 8. 继续对话

```
POST /api/sessions/:id/resume
```

**请求体**（可选）：
```json
{
  "extraRounds": 5
}
```

`extraRounds` 可以追加额外轮数。不传就用剩余轮数继续。

---

### 9. 停止对话

```
POST /api/sessions/:id/stop
```

永久结束这个 session，状态变为 `done`。

---

### 10. 人类插入消息

```
POST /api/sessions/:id/message
```

**请求体**：
```json
{
  "content": "等一下，我觉得方向不对，换个思路"
}
```

| 字段 | 说明 |
|------|------|
| `content` | 你要说的话 |

注入消息固定按 `human` 角色记录。`done` 状态下发送消息会自动把 session 重新打开为 `active`，并从当前轮数继续。

---

### 11. 接管对话（Takeover）

```
POST /api/sessions/:id/takeover
```

暂停对话并标记为人类接管。之后你可以通过 `/message` 手动发消息，完全控制对话。

---

### 12. 释放对话（Release）

```
POST /api/sessions/:id/release
```

取消接管，恢复 agent 自动对话。

---

## Session 生命周期

```
创建 → active（自动对话中）
         ↓ pause
       paused（暂停）
         ↓ resume / release
       active
         ↓ stop / 达到 maxRounds
       done

任何阶段出错 → error
```

## 配置

配置文件：`~/.turing/config.json`

```json
{
  "agents": {
    "claude-code": {
      "adapter": "claude-code",
      "env": {
        "ANTHROPIC_BASE_URL": "https://your-proxy.com",
        "ANTHROPIC_AUTH_TOKEN": "sk-xxx"
      }
    },
    "opencode": {
      "adapter": "opencode",
      "command": "/path/to/opencode"
    }
  }
}
```

会跟默认配置深度合并，你只需要写要覆盖的部分。完整配置说明见项目根目录的 `README.md`。

## 数据

- SQLite 数据库：`~/.turing/turing.db`
- 所有 session 和消息都持久化，重启不丢
- 消息默认保留 30 天，可在配置中调整

## WebSocket

Web UI 通过 WebSocket 实时推送事件。连接 `ws://localhost:4590`，接收：

| 事件 | 说明 |
|------|------|
| `session:created` | 新 session |
| `session:updated` | session 状态变化 |
| `session:done` | 对话结束 |
| `session:error` | 出错 |
| `session:paused` | 暂停 |
| `message:new` | 新消息 |
| `agent:status` | agent 状态变化 |
