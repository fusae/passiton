# Contributing to Turing

Thanks for your interest in contributing! Turing is a local-first, agent-to-agent orchestration tool. This guide will get you set up.

## Quick Start

```bash
git clone <repo-url> turing
cd turing
npm install
npm run build
npm start
```

Open `http://localhost:4590`.

## Prerequisites

- **Node.js 20+**
- At least one CLI agent installed if you want to test sessions end-to-end: [Codex](https://github.com/openai/codex), [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), or [OpenCode](https://github.com/sst/opencode)
- For API-only testing, you can configure an API assistant (Anthropic, OpenAI, DeepSeek, Zhipu) without any local CLI

## Development

```bash
npm run dev      # TypeScript watch mode
npm test         # Build + run the full test suite
npm run build    # Compile TypeScript + copy web assets
```

The test suite uses Node's built-in test runner (`node:test`). Tests live in `src/tests/` and cover router logic, state persistence, auth, config, and adapters.

## Project Structure

```
src/
├── index.ts          Entry point
├── server.ts         HTTP + WebSocket server, API routes
├── router.ts         Session/task/pipeline lifecycle and message routing (core)
├── state.ts          SQLite persistence layer
├── agents.ts         Agent discovery and health probing
├── adapters/         Adapter implementations
│   ├── factory.ts    Adapter factory + registration
│   ├── claude-code.ts, codex.ts, gemini.ts, opencode.ts   CLI agent adapters
│   └── api/          API assistant adapters (anthropic, openai, zhipu)
├── policy.ts         Round/timeout/completion policy
├── prompts.ts        System prompt generation per session mode
├── templates.ts      Built-in session and pipeline templates
├── auth.ts           JWT auth, local access, API tokens
├── keyvault.ts       Encrypted provider key storage
├── config.ts         Config loading (~/.turing/config.json)
├── cli.ts            `turing` CLI
└── web/              Frontend (vanilla JS, no build step)
```

## Code Style

- TypeScript with strict mode (`tsconfig.json`)
- ESM modules (`.js` imports in `.ts` files)
- No runtime dependencies beyond `better-sqlite3`, `ws`, `uuid` — keep the dependency surface minimal
- No comments unless explaining non-obvious logic
- Follow existing patterns in neighboring files

## Before Opening a PR

1. `npm run build` passes with no errors
2. `npm test` passes (all 93+ tests green)
3. No new runtime dependencies without justification
4. If you add a feature, add or update tests
5. If you change HTTP API behavior, update `docs/EXTERNAL_AGENT_USAGE.md`

## Experimental Features

The `gemini-image` adapter and Dreamina video pipeline are **experimental** and require external binaries/credentials. They degrade gracefully (disabled when unconfigured) — do not make core paths depend on them.

## Reporting Issues

- Bugs: open a GitHub issue with reproduction steps, Node version, and OS
- Security vulnerabilities: see [SECURITY.md](./SECURITY.md) — do not open public issues for security reports

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE).
