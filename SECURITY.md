# Security Policy

## Supported Versions

Turing is local-first software. Only the latest release receives security updates.

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please report suspected vulnerabilities privately:

- Open a **private** GitHub Security Advisory (Repo → Security → Advisories → New advisory), or
- Email the maintainer directly

Please include:
- A description of the issue and its potential impact
- Steps to reproduce or a proof of concept
- Affected versions, if known

You should receive an initial response within 72 hours. Please allow reasonable time for assessment and a fix before any public disclosure.

## Trust Model

Turing is designed to run locally on your machine. Its defaults assume a single trusted user:

- **Local access is enabled by default** (`auth.localAccess: true`). The first local user is auto-logged-in without a password.
- **Registration is disabled by default** (`auth.allowRegistration: false`).
- **JWT secret is auto-generated** on first run and persisted to `~/.turing/config.json`. Set `TURING_JWT_SECRET` explicitly if you need a stable secret across reinstalls.

## Exposure Warning

If you expose Turing beyond `localhost` (Tailscale, Cloudflare Tunnel, LAN, public internet), you **must**:

1. Disable local access: `TURING_LOCAL_ACCESS=false`
2. Set an explicit `TURING_JWT_SECRET`
3. Restrict `policy.allowedWorkspaces` to specific directories
4. Use the `trusted` permission mode only with narrowly scoped `cwd` values

The `trusted` permission mode injects auto-approve flags into CLI agents. Never enable it for agents running against sensitive or shared directories.

## Provider Keys

API keys (Anthropic, OpenAI, etc.) are encrypted at rest using AES-256-GCM with a key derived from `TURING_ENCRYPTION_KEY` (auto-generated if unset). The encrypted material lives in `~/.turing/turing.db`. Protect your `~/.turing/` directory with appropriate filesystem permissions.

## Scope

This policy covers the Turing application code. It does not cover:
- The behavior of third-party CLI agents that Turing invokes (Codex, Claude Code, etc.) — refer to their own policies
- The experimental Dreamina and Gemini Image integrations — these invoke external binaries and are disabled by default
