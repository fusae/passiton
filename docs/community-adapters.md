# Community Adapters

Turing's core ships with adapters for four CLI agents that have stable,
non-interactive modes:

| Agent | Adapter | Status |
|-------|---------|--------|
| [Codex](https://github.com/openai/codex) | `codex` | Bundled |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `claude-code` | Bundled |
| [Gemini CLI](https://github.com/google-gemini/gemini-cli) | `gemini-cli` | Bundled |
| [OpenCode](https://github.com/sst/opencode) | `opencode` | Bundled |

## Other agents we know about

These CLI agents are **not** auto-discovered or bundled, because they lack a
stable non-interactive mode, require an editor host, or have licensing
constraints. If you want to use one, you can register a custom adapter (see
`src/adapters/`) — and we welcome PRs to promote an entry below into a bundled
adapter.

- **aider** — AI pair programming in the terminal. Has `--message` for
  non-interactive runs; a good candidate for a community adapter.
- **goose** — Block's open-source agent. Has a headless `session` mode.
- **amp** — Sourcegraph's agent.
- **cursor** (`cursor-agent`) — Cursor's CLI.
- **windsurf** — Codeium's agent.
- **copilot** (`gh copilot`) — GitHub Copilot CLI.
- **cline**, **continue**, **roo-code**, **kilo-code** — editor extensions,
  primarily run inside VS Code; no clean standalone mode.
- **openhands** — autonomous agent runtime.
- **devin**, **swe-agent** — autonomous/CI-oriented agents.
- **kiro**, **zed-agent** (`zed`) — editor-integrated agents.

## Writing an adapter

A CLI adapter is a small class implementing the `Adapter` interface (see
`src/types.ts`). At minimum:

1. Spawn your binary with the user's prompt as a CLI arg.
2. Stream stdout, call `opts.onOutput(line)` for live progress.
3. Resolve with the agent's final text (or an `AdapterResponse`).

Register it with `router.registerAdapter(new MyAdapter())`. See the existing
adapters in `src/adapters/` for complete examples.

## Writing an external-task provider

For integrations that aren't agents but "submit a job and poll until done"
(video generation, rendering, batch processing), implement
`ExternalTaskProvider` instead — see
[README §扩展点](../README.md#扩展点external-task-providers) and the bundled
Dreamina provider at `src/examples/dreamina/`.
