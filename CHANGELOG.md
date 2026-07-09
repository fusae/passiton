# Changelog

All notable changes to Passiton are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Project renamed to Passiton; docs, README, and landing page positioning now reflect the local-first open-source launch. TURING_* env vars and ~/.turing remain supported as fallbacks.
- Fully internationalized the UI: English is the default, Chinese is available via Settings, and server-side user-facing messages are now plain English.
- Default `features.localCliAgents` to `true` for local-first onboarding. Cloud deployments set `PASSITON_LOCAL_CLI_AGENTS=false` (Fly.io config updated automatically).
- Removed hardcoded personal binary paths from `DREAMINA_COMMAND` and `GeminiImageAdapter`. Both now require explicit environment configuration and degrade gracefully when unconfigured.
- Rewrote `docs/README.md` to remove personal-assistant references and fix path/status inaccuracies.
- Added `stopped` to documented session status values in `docs/EXTERNAL_AGENT_USAGE.md`.
- Aligned README and CONTRIBUTING quickstart commands, agent status flow, External Task Provider import paths, HTTP API endpoint list, and `timeout` semantics with actual code behavior.

### Added

- Task handoff endpoint and UI for continuing errored or stopped tasks with a ready agent.
- `agentManagement` section in `GET /api/docs` self-describing API reference, documenting `POST /api/agents` (API Assistant), `PUT`/`DELETE /api/agents/:name`, and `POST`/`PUT`/`DELETE /api/config/agents` (local CLI Agent config) with required fields and minimal body examples.
- `LICENSE` (Apache-2.0), `CONTRIBUTING.md`, `SECURITY.md`, this `CHANGELOG.md`.
- Environment variable `PASSITON_GEMINI_SKILL_SCRIPT` for the experimental Gemini Image adapter.

### Fixed

- Landing page content was invisible under `prefers-reduced-motion` because the entrance animation held `opacity:0` and never recovered.
- Startup on an occupied port crashed with a raw stack trace; it now prints a single actionable error line.
- The `PORT` environment variable was documented in `.env.example` but never read by the server; it is now honoured with priority `PORT` > config file `server.port` > default `4590`.

## [0.1.0] - 2026-06-21

Initial public baseline. Local-first agent-to-agent orchestration:

- **Task**: single-agent execution with delegation support.
- **Session**: two-agent collaboration with human-in-the-loop (pause, nudge, takeover).
- **Workflow/Pipeline**: multi-step sessions with dependencies, parallel steps, manual approval, and file preview.
- **CLI Agents**: Codex, Claude Code, OpenCode, Gemini CLI.
- **API Assistants**: Anthropic, OpenAI, DeepSeek, Zhipu, and OpenAI-compatible.
- **Capability constraints**: API assistants cannot touch the local filesystem; `cwd` tasks require a local CLI agent.
- **Permission modes**: `safe` (default) and `trusted` (auto-approve for trusted workspaces).
- **Persistence**: SQLite at `~/.passiton/turing.db` with configurable message retention.
- **Web UI**, HTTP API, WebSocket events, and `passiton` CLI.
- **Auth**: JWT with auto-generated secret on first run, encrypted provider key vault, local-access auto-login.

[Unreleased]: https://github.com/fusae/passiton/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/fusae/passiton/releases/tag/v0.1.0
