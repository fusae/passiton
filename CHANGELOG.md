# Changelog

All notable changes to Turing are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Default `features.localCliAgents` to `true` for local-first onboarding. Cloud deployments set `TURING_LOCAL_CLI_AGENTS=false` (Fly.io config updated automatically).
- Removed hardcoded personal binary paths from `DREAMINA_COMMAND` and `GeminiImageAdapter`. Both now require explicit environment configuration and degrade gracefully when unconfigured.
- Rewrote `docs/README.md` to remove personal-assistant references and fix path/status inaccuracies.
- Added `stopped` to documented session status values in `docs/EXTERNAL_AGENT_USAGE.md`.

### Added

- `LICENSE` (Apache-2.0), `CONTRIBUTING.md`, `SECURITY.md`, this `CHANGELOG.md`.
- Environment variable `TURING_GEMINI_SKILL_SCRIPT` for the experimental Gemini Image adapter.

## [0.1.0] - 2026-06-21

Initial public baseline. Local-first agent-to-agent orchestration:

- **Task**: single-agent execution with delegation support.
- **Session**: two-agent collaboration with human-in-the-loop (pause, nudge, takeover).
- **Workflow/Pipeline**: multi-step sessions with dependencies, parallel steps, manual approval, and file preview.
- **CLI Agents**: Codex, Claude Code, OpenCode, Gemini CLI.
- **API Assistants**: Anthropic, OpenAI, DeepSeek, Zhipu, and OpenAI-compatible.
- **Capability constraints**: API assistants cannot touch the local filesystem; `cwd` tasks require a local CLI agent.
- **Permission modes**: `safe` (default) and `trusted` (auto-approve for trusted workspaces).
- **Persistence**: SQLite at `~/.turing/turing.db` with configurable message retention.
- **Web UI**, HTTP API, WebSocket events, and `turing` CLI.
- **Auth**: JWT with auto-generated secret on first run, encrypted provider key vault, local-access auto-login.

[Unreleased]: https://github.com/<owner>/<repo>/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/<owner>/<repo>/releases/tag/v0.1.0
