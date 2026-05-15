# Turing

本地运行的 agent-to-agent 对话代理。HTTP API、Web UI、SQLite 持久化都在一个进程里。

## 开发

```bash
npm install
npm run build
npm start
```

默认地址：`http://localhost:4590`

## 配置

配置文件：`~/.turing/config.json`

最小示例：

```json
{
  "agents": {
    "codex": {
      "adapter": "codex",
      "command": "codex",
      "args": ["exec", "--full-auto", "--ephemeral", "--skip-git-repo-check", "{prompt}"],
      "timeout": 300000
    },
    "claude-code": {
      "adapter": "claude-code",
      "command": "claude",
      "args": ["-p", "{prompt}", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"],
      "timeout": 300000
    },
    "opencode": {
      "adapter": "opencode",
      "command": "opencode",
      "args": ["run", "{prompt}", "--dangerously-skip-permissions"],
      "timeout": 300000,
      "model": "gpt-4.1"
    },
    "gemini-cli": {
      "adapter": "gemini-cli",
      "command": "gemini",
      "args": ["-p", "{prompt}"],
      "timeout": 300000
    }
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

## 常用命令

```bash
npm run build
npm run test
node dist/index.js
```

## API

主要接口：

- `GET /api/agents`
- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/stop`
- `GET /api/sessions`
- `POST /api/sessions`
- `GET /api/sessions/:id`
- `POST /api/sessions/:id/pause`
- `POST /api/sessions/:id/resume`
- `POST /api/sessions/:id/stop`
- `POST /api/sessions/:id/message`
- `POST /api/sessions/:id/nudge`

完整说明见 [docs/README.md](docs/README.md)。

## 数据保留

消息默认保留 30 天，启动时和运行中会自动清理过期消息。

```json
{
  "policy": {
    "messageRetentionMs": 2592000000
  }
}
```

设为 `0` 可关闭消息 GC。
