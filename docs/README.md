# Passiton Docs

Passiton is a local-first multi-agent orchestration server. It runs on your machine, uses your configured CLI agents and API keys, and stores state in local SQLite.

## Start Locally

```bash
npm install
npm run build
npm start
```

Open `http://localhost:4590`.

## Main References

- [README](../README.md): product overview, quick start, configuration, security model, MCP, and External Task Providers
- [External Agent Usage](./EXTERNAL_AGENT_USAGE.md): HTTP API examples for tasks, sessions, workflows, handoff, and MCP setup
- [Community Adapters](./community-adapters.md): bundled adapters and guidance for adding more
- [Security](../SECURITY.md): localhost defaults, exposure requirements, and provider key handling
- `GET /api/docs`: machine-readable API reference served by a running Passiton instance

## Concepts

- **Task**: one lead agent runs a job.
- **Session**: two agents collaborate with optional human feedback.
- **Workflow**: multi-step sessions with dependencies, approval gates, and reruns.
- **Handoff**: an errored or stopped task can be continued by another ready agent, with prior output and workspace state included.
- **External Task Provider**: a plugin point for integrations that submit a remote job and poll until completion.

## Naming Notes

The project is now Passiton. Current environment variables use `PASSITON_*`, and MCP tools use `passiton_*`. Legacy `TURING_*` variables and existing `~/.turing/` data are still accepted as compatibility fallbacks.
