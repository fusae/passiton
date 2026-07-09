# Contributing to Passiton

Passiton is a local-first, agent-to-agent orchestration tool. This guide covers local development.

## Quick Start

```bash
git clone https://github.com/fusae/passiton.git
cd passiton
npm install
npm run build
npm start
```

Open `http://localhost:4590`.

Optional verification:

```bash
npm test
```

## Prerequisites

- Node.js 20+
- At least one CLI agent for filesystem/session testing: Codex, Claude Code, Gemini CLI, or OpenCode
- Optional API assistants: Anthropic, OpenAI, DeepSeek, Zhipu, Qwen, Moonshot, or OpenAI-compatible endpoints

## Development

```bash
npm run dev      # TypeScript watch mode
npm test         # Build + run the full test suite
npm run build    # Compile TypeScript + copy web assets
```

Tests use Node's built-in test runner. They live in `src/tests/` and cover router logic, state persistence, auth, config, server routes, and adapters.

## Project Structure

```text
src/
├── index.ts          entry point
├── server.ts         HTTP + WebSocket server, API routes, MCP gateway
├── router.ts         task/session/workflow lifecycle and routing
├── state.ts          SQLite persistence layer
├── agents.ts         agent discovery and health probing
├── adapters/         CLI and API adapter implementations
├── policy.ts         round/timeout/completion policy
├── prompts.ts        system prompt generation
├── templates.ts      built-in session and workflow templates
├── auth.ts           JWT auth, local access, API tokens
├── keyvault.ts       encrypted provider key storage
├── config.ts         config loading (`~/.passiton/config.json`)
├── cli.ts            `passiton` CLI
└── web/              frontend (vanilla JS, copied during build)
```

## Code Style

- TypeScript strict mode
- ESM modules with `.js` imports in `.ts` files
- Keep the runtime dependency surface small
- Add comments only for non-obvious logic
- Follow neighboring file patterns

## Before Opening a PR

1. `npm run build` passes.
2. `npm test` passes.
3. No new runtime dependency is added without justification.
4. Do not commit `.env`, API keys, local certificates, logs, or SQLite databases.
5. Add or update tests for behavior changes.
6. Update `docs/EXTERNAL_AGENT_USAGE.md` and `/api/docs` behavior if HTTP API behavior changes.

## Adding an Adapter

Start in `src/adapters/types.ts`, add the implementation under `src/adapters/`, register it in `src/adapters/factory.ts`, then add focused tests under `src/tests/`.

## Experimental Features

The Gemini Image adapter and Dreamina video provider are experimental and require external binaries or credentials. They are disabled when unconfigured; core paths must not depend on them.

## Reporting Issues

- Bugs: open an issue with reproduction steps, Node version, and OS.
- Security vulnerabilities: see [SECURITY.md](./SECURITY.md); do not open public issues for security reports.

## License

By contributing, you agree that your contributions are licensed under the [Apache-2.0 License](./LICENSE).
