# Community Adapters

Passiton ships with adapters for four CLI agents that have usable non-interactive modes:

| Agent | Adapter | Status |
| --- | --- | --- |
| [Codex](https://github.com/openai/codex) | `codex` | Bundled |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `claude-code` | Bundled |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini-cli` | Bundled |
| [OpenCode](https://github.com/sst/opencode) | `opencode` | Bundled |

API assistants are also supported through Anthropic, OpenAI, DeepSeek, Zhipu, Qwen, Moonshot, and custom OpenAI-compatible adapters.

## Add Any CLI Agent From The UI

Use Settings → Agents → Local CLI Agents → **Add custom agent** for CLIs that are not auto-discovered, such as aider, goose, qwen-code, or cursor-agent. Enter the display name, command, one argument per line, optional `KEY=VALUE` environment variables, and optional timeout. Arguments must include `{prompt}`; Passiton replaces that token with the task prompt before spawning the command.

## Add Any CLI Agent Over The API

The same custom CLI registration is available over `POST /api/config/agents`:

```bash
BASE=http://127.0.0.1:4590
TOKEN="$(curl -s -X POST "$BASE/api/auth/local" | node -pe "JSON.parse(fs.readFileSync(0, 'utf8')).token")"

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
```

For `custom-cli`, `args` must include the `{prompt}` token. If it is missing, the API rejects the request with a validation error so the agent definition can be corrected before use.

## Other Agents We Know About

These CLI agents are not auto-discovered or bundled today because they need a cleaner non-interactive mode, require an editor host, or need adapter work:

- **aider**: has `--message`; a good community adapter candidate.
- **goose**: has a headless `session` mode.
- **amp**: Sourcegraph's agent.
- **cursor** (`cursor-agent`): Cursor's CLI.
- **windsurf**: Codeium's agent.
- **copilot** (`gh copilot`): GitHub Copilot CLI.
- **cline**, **continue**, **roo-code**, **kilo-code**: primarily VS Code extensions.
- **openhands**, **devin**, **swe-agent**: autonomous or CI-oriented agents.
- **kiro**, **zed-agent** (`zed`): editor-integrated agents.

## Writing an Adapter

A CLI adapter implements the `Adapter` interface. At minimum:

1. Spawn the binary with the prompt.
2. Stream stdout through `opts.onOutput(line)` for live progress.
3. Resolve with final text or an `AdapterResponse`.

Register it with `router.registerAdapter(new MyAdapter())`. Existing examples live in `src/adapters/`.

## Writing an External Task Provider

For integrations that submit a job and poll until done, such as video generation, rendering, or batch processing, implement `ExternalTaskProvider` instead. See [README § External Task Providers](../README.md#external-task-providers) and the bundled Dreamina provider in `src/examples/dreamina/`.
