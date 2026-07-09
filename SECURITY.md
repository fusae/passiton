# Security Policy

## Supported Versions

Passiton is local-first software. Only the latest release receives security updates.

## Reporting a Vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Please report suspected vulnerabilities privately through a GitHub Security Advisory for `fusae/passiton`.

Include:

- description and impact
- reproduction steps or proof of concept
- affected versions, if known

You should receive an initial response within 72 hours.

## Trust Model

Passiton is designed to run locally on your machine. Defaults assume a single trusted user:

- Local access is enabled by default (`auth.localAccess: true`).
- Registration is disabled by default (`auth.allowRegistration: false`).
- JWT secret is auto-generated on first run and persisted to `~/.passiton/config.json`.
- Existing `~/.turing/` installs are still reused for compatibility.
- CLI agents are high-privilege local processes. A task with `cwd` can cause an agent to read, modify, or execute commands inside the permitted workspace.

## Exposure Warning

If you expose Passiton beyond `localhost` through Tailscale, Cloudflare Tunnel, LAN, or the public internet, you must:

1. Disable local access: `PASSITON_LOCAL_ACCESS=false`
2. Set an explicit `PASSITON_JWT_SECRET`
3. Restrict `policy.allowedWorkspaces` to specific directories
4. Use `trusted` permission mode only with narrowly scoped `cwd` values

Startup fails fast for non-localhost binds unless authentication is explicit and workspaces are restricted.

The `trusted` permission mode injects auto-approve flags into supported CLI agents. Never enable it for agents running against sensitive or shared directories.

## Provider Keys

API keys are encrypted at rest using AES-256-GCM with key material from `PASSITON_ENCRYPTION_KEY` when set, or an auto-generated local key otherwise. The encrypted material lives in the local SQLite database under the Passiton data directory. Protect that directory with appropriate filesystem permissions.

Legacy `TURING_*` environment variables are accepted as fallbacks for matching `PASSITON_*` names.

## Scope

This policy covers the Passiton application code. It does not cover:

- third-party CLI agents invoked by Passiton, such as Codex or Claude Code
- experimental Dreamina and Gemini Image integrations, which invoke external binaries and are disabled when unconfigured
