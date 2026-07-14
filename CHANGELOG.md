# Changelog

All notable changes to Passiton are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-07-14

### Added

- Local CLI agents can now be auto-discovered and verified before use.
- Local CLI agents now support configurable priority, and task creation without an explicit agent automatically selects the highest-priority usable agent.
- Task handoff now supports running source tasks by stopping them before creating the continuation task.
- Task detail pages now show git commits made by the task.
- Allowed Workspaces writes now reject unsafe roots such as temp directories, OS roots, and home-directory roots, with load-time security warnings for suspicious existing entries.
- Custom CLI agents can now be added from Settings with a generic `custom-cli` adapter, including `{prompt}` argument substitution, env vars, timeout, diagnostics, and an empty-state add path.
- Ops steward now has its own encrypted model configuration in the Ops panel, with API Assistant fallback preserved for existing users.

### Fixed

- Windows agent discovery now prefers PowerShell shims, supports Codex npm shims, and hardens CLI shim execution.
- OpenCode diagnostics are now more robust across platforms.
- Agent settings cards now stay aligned across local CLI states.
- Claude Code protocol events are now filtered out of task output.
- `GET /api/agents` no longer blocks on child-process version probes, so agent lists load instantly.
- Priority reorder arrows now apply optimistic reordering instantly and have larger hit targets.

### Changed

- Agent settings now focus on verified local CLIs.
- Priority controls now explain that list order determines default agent priority.
- README now frames Passiton as a control plane and documents both UI and HTTP API operation.

## [0.2.1] - 2026-07-10

### Added

- Local visitors now skip the marketing landing page and auto-login directly into the app.
- Settings is reduced from six tabs to two focused tabs: Agents and General.

### Fixed

- Local CLI agent verification now persists across refreshes and restarts.
- Windows agent discovery: `resolveCommand` now tries `.exe`, `.cmd`, `.bat` extensions (and respects `PATHEXT`) so agents like `claude.exe` and `codex.cmd` are found instead of only the bare name. Previously `claude` installed at `~/.local/bin/claude.exe` was invisible because the resolver only checked the exact name.
- Windows spawn correctness: `.cmd` and `.bat` files are now spawned via `shell: true` (required since Node.js CVE-2024-27980). `.exe` files spawn directly.
- Windows workspace path matching: separators and case are normalized so `C:\Users\X\Projects` matches `c:/users/x/projects`.
- Added Windows-common search paths: `%APPDATA%\npm`, `~/scoop/shims`, `%ProgramData%\chocolatey\bin`, `%LOCALAPPDATA%\Programs`.
- Separator-portable paths are used for bundled agent dependencies.
- Cross-platform build/test scripts: `build` and `test` now use Node-based scripts instead of Unix-only shell commands, and the test runner discovers tests explicitly instead of relying on shell glob behavior.

## [0.2.0] - 2026-07-09

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

[Unreleased]: https://github.com/fusae/passiton/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/fusae/passiton/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/fusae/passiton/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/fusae/passiton/releases/tag/v0.2.0
[0.1.0]: https://github.com/fusae/passiton/releases/tag/v0.1.0
