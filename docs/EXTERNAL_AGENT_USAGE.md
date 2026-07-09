# Passiton HTTP API Usage

Passiton is a local-first orchestration server. Use the HTTP API to create tasks, sessions, and workflows, then poll for status or continue work through handoff.

Base URL:

```text
http://localhost:4590
```

The running server exposes a machine-readable reference at:

```text
GET /api/docs
```

## Authentication

Most `/api/*` endpoints require a Bearer token.

```http
Authorization: Bearer <token>
```

Local mode can get a token without a password:

```bash
curl -s -X POST http://localhost:4590/api/auth/local | jq -r '.token'
```

Password login is also available when users are configured:

```bash
curl -s -X POST http://localhost:4590/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<password>"}' \
  | jq -r '.token'
```

## Core Concepts

- **Task**: assign one agent a job.
- **Session**: two agents collaborate until done, stopped, paused, or errored.
- **Workflow**: multi-step sessions with dependencies and optional approval gates.
- **Agent**: a local CLI adapter or API assistant.
- **Handoff**: continue an errored or stopped task with another ready agent.

Tasks and sessions with `cwd` require a filesystem-capable local CLI agent.

## Agents

```text
GET /api/agents
GET /api/agents?refresh=1
GET /api/agents/:name/diagnostics
```

Local agent statuses include `discovered`, `unverified`, `ready`, and `invalid`. API assistants may show `no_key`, `unverified`, `ready`, or `invalid`.

## Tasks

Create a task:

```bash
curl -s -X POST http://localhost:4590/api/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {"adapter": "opencode"},
    "prompt": "Write a concise project summary.",
    "cwd": "/path/to/project",
    "permissionMode": "safe",
    "context": {
      "rules": "Return markdown only.",
      "text": "Background information here."
    }
  }'
```

Read or stop tasks:

```text
GET  /api/tasks
GET  /api/tasks?status=done
GET  /api/tasks/:id
POST /api/tasks/:id/stop
```

Task statuses: `queued`, `running`, `done`, `error`, `stopped`.

When done, `output` contains full agent output and `result` contains the extracted `[RESULT]...[/RESULT]` block when present.

## Task Handoff

Only errored or stopped tasks can be handed off:

```bash
curl -s -X POST http://localhost:4590/api/tasks/$TASK_ID/handoff \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"agent":{"adapter":"codex"}}'
```

The new task receives the original prompt, previous output tail, error/stop reason, and git workspace state when Passiton can collect it.

## Sessions

Create a session:

```bash
curl -s -X POST http://localhost:4590/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from": {"adapter": "codex"},
    "to": {"adapter": "opencode"},
    "initialPrompt": "Review this repository and propose a small cleanup.",
    "mode": "collaborate",
    "maxRounds": 5,
    "cwd": "/path/to/project",
    "context": {
      "files": ["README.md"],
      "rules": "Be concise."
    }
  }'
```

Session fields:

| Field | Required | Description |
| --- | --- | --- |
| `from.adapter` | yes | initiating agent |
| `to.adapter` | yes | responding agent |
| `initialPrompt` | yes | first message |
| `mode` | no | `collaborate`, `discuss`, `review`, or `freeform` |
| `maxRounds` | no | max turns |
| `approveMode` | no | require human approval between rounds |
| `permissionMode` | no | `safe` or `trusted` |
| `cwd` | no | working directory for CLI agents |
| `context.files` | no | files read once and injected as context |
| `context.rules` | no | constraints |
| `context.text` | no | background text |

Session operations:

```text
GET    /api/sessions
GET    /api/sessions?status=active
GET    /api/sessions/:id
POST   /api/sessions/:id/pause
POST   /api/sessions/:id/resume
POST   /api/sessions/:id/stop
POST   /api/sessions/:id/message
DELETE /api/sessions/:id
```

Session statuses: `active`, `paused`, `done`, `error`, `stopped`.

Inject human feedback:

```bash
curl -s -X POST http://localhost:4590/api/sessions/$SESSION_ID/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Change direction: focus on the API docs first."}'
```

## Workflows

List templates:

```text
GET /api/pipeline-templates
```

Create a workflow:

```bash
curl -s -X POST http://localhost:4590/api/pipelines \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Two-step review",
    "steps": [
      {
        "title": "Draft",
        "from": {"adapter": "codex"},
        "to": {"adapter": "opencode"},
        "initialPrompt": "Draft the change.",
        "cwd": "/path/to/project"
      },
      {
        "title": "Review",
        "from": {"adapter": "codex"},
        "to": {"adapter": "opencode"},
        "initialPrompt": "Review the previous step.",
        "dependsOn": [0],
        "approveMode": true,
        "cwd": "/path/to/project"
      }
    ]
  }'
```

Workflow operations:

```text
GET    /api/pipelines
GET    /api/pipelines/:id
POST   /api/pipelines/:id/pause
POST   /api/pipelines/:id/resume
DELETE /api/pipelines/:id
```

`dependsOn` uses zero-based step indices. Steps without dependencies may run in parallel.

## MCP

Passiton exposes Streamable HTTP MCP at:

```text
GET  /mcp
POST /mcp
GET  /api/mcp
POST /api/mcp
```

Use a Bearer token or `?token=...`.

Common MCP tools:

- `passiton_list_agents`
- `passiton_create_task`
- `passiton_get_task_result`
- `passiton_create_session`
- `passiton_send_feedback`
- `passiton_get_progress`
- `passiton_create_workflow`
- `passiton_get_workflow`
- `passiton_approve_step`
- `passiton_retry_step`
- `passiton_stop_run`
- `passiton_read_artifact`

## Environment

Use `PASSITON_*` variables for current configuration, such as `PASSITON_HOME`, `PASSITON_HOST`, `PASSITON_JWT_SECRET`, `PASSITON_LOCAL_ACCESS`, and `PASSITON_ALLOWED_WORKSPACES`. Legacy `TURING_*` names are still accepted as fallbacks.

Repository URL: `https://github.com/fusae/passiton`.
