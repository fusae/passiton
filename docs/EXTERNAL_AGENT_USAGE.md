# Turing API Reference

Turing is an agent-to-agent orchestration server. You can use its HTTP API to create tasks, sessions, and pipelines, then poll for results.

**Base URL:** `http://localhost:4590`

---

## Authentication

All `/api/*` endpoints require a Bearer token.

```
Authorization: Bearer <token>
```

Get a token by logging in:

```bash
curl -s -X POST http://localhost:4590/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "<email>", "password": "<password>"}' \
  | jq -r '.token'
```

---

## Core Concepts

- **Task** — Assign one lead agent a job. That agent may still follow an existing workflow and create sessions or pipelines when delegation is required.
- **Session** — Two agents collaborate until done. One agent (from) initiates, another (to) responds. They alternate until the work is complete or max rounds is reached.
- **Pipeline** — A multi-step workflow: multiple sessions chained together. Each step can depend on previous steps. Steps run in order (or parallel if no dependency).
- **Agent** — A configured model endpoint (e.g. "claude-sonnet", "gpt-4.1"). Each agent has an adapter type (anthropic-api, openai-api, etc.) and a model name.

---

## Tasks

### Create a Task

```
POST /api/tasks
```

```json
{
  "agent": { "adapter": "opencode" },
  "prompt": "Write the article from this brief.",
  "cwd": "/path/to/project",
  "context": {
    "rules": "Write in Chinese. Output markdown only.",
    "text": "Background information here"
  }
}
```

**Response:** Task object with `id` and `status: "queued"`.

### Get Task

```
GET /api/tasks/<id>
GET /api/tasks?status=done
POST /api/tasks/<id>/stop
```

Status values: `queued`, `running`, `done`, `error`, `stopped`.

When `status` is `done`:
- `output` contains the complete agent output
- `result` contains the extracted `[RESULT]...[/RESULT]` block, or the full output if no block was used

### Create a task and wait for the result

```bash
TASK_ID=$(curl -s -X POST http://localhost:4590/api/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {"adapter": "opencode"},
    "prompt": "Write the article from this brief.",
    "cwd": "/path/to/project"
  }' | jq -r '.id')

while true; do
  STATUS=$(curl -s http://localhost:4590/api/tasks/$TASK_ID \
    -H "Authorization: Bearer $TOKEN" | jq -r '.status')
  [ "$STATUS" = "done" ] || [ "$STATUS" = "error" ] && break
  sleep 5
done

curl -s http://localhost:4590/api/tasks/$TASK_ID \
  -H "Authorization: Bearer $TOKEN" | jq -r '.result'
```

---

## Sessions

### Create a Session

```
POST /api/sessions
```

```json
{
  "from": { "adapter": "<agent-name>" },
  "to": { "adapter": "<agent-name>" },
  "initialPrompt": "Your task description here",
  "mode": "collaborate",
  "maxRounds": 5,
  "context": {
    "rules": "Optional constraints or instructions",
    "text": "Optional background information",
    "files": ["optional/file/paths"]
  }
}
```

**Fields:**
| Field | Required | Description |
|-------|----------|-------------|
| from.adapter | Yes | Agent name for the initiator |
| to.adapter | Yes | Agent name for the responder |
| initialPrompt | Yes | The task description |
| mode | No | `collaborate` (default), `discuss`, `review`, `freeform` |
| maxRounds | No | Max conversation turns (default: 5) |
| context.rules | No | Constraints the agents must follow |
| context.text | No | Background information injected into context |
| context.files | No | File paths to include as context |
| cwd | No | Working directory for CLI agents |

**Response:** Session object with `id` and `status: "active"`.

### Get Session (check status & results)

```
GET /api/sessions/<id>
```

**Response:** Session object with `status` and `messages` array.

Status values: `active`, `paused`, `done`, `error`, `stopped`.

When `status` is `done`, the result is in the last message's content. If the agent used `[RESULT]...[/RESULT]` tags, the result is extracted into `artifacts.summary`.

### List Sessions

```
GET /api/sessions
GET /api/sessions?status=done
```

### Pause / Resume / Stop

```
POST /api/sessions/<id>/pause
POST /api/sessions/<id>/resume
POST /api/sessions/<id>/stop
```

### Inject a Message (human intervention)

```
POST /api/sessions/<id>/message
```
```json
{ "content": "Change direction: focus on X instead" }
```

### Delete a Session

```
DELETE /api/sessions/<id>
```

---

## Pipelines (Workflows)

### List Pipeline Templates

```
GET /api/pipeline-templates
```

Returns built-in reusable workflow templates. The Web UI can use them to prefill pipeline steps.

### Create / Delete User Pipeline Templates

```
POST /api/pipeline-templates
DELETE /api/pipeline-templates/<id>
```

User templates persist reusable pipeline structure and are returned together with built-in templates.

### Create a Pipeline

```
POST /api/pipelines
```

```json
{
  "name": "Content Production",
  "steps": [
    {
      "from": { "adapter": "<agent-name>" },
      "to": { "adapter": "<agent-name>" },
      "initialPrompt": "Step 1: Research the topic...",
      "mode": "collaborate",
      "maxRounds": 3
    },
    {
      "from": { "adapter": "<agent-name>" },
      "to": { "adapter": "<agent-name>" },
      "initialPrompt": "Step 2: Write the article based on research...",
      "mode": "collaborate",
      "maxRounds": 5,
      "dependsOn": [0]
    }
  ]
}
```

`dependsOn` is an array of step indices (0-based). A step only starts after its dependencies complete. Omit for parallel execution.

### Get Pipeline Status

```
GET /api/pipelines/<id>
```

Returns pipeline with all step statuses and session details.

### Pause / Resume / Delete

```
POST /api/pipelines/<id>/pause
POST /api/pipelines/<id>/resume
DELETE /api/pipelines/<id>
```

---

## Common Patterns

### Create a session and wait for the result

```bash
# 1. Create
SESSION_ID=$(curl -s -X POST http://localhost:4590/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from": {"adapter": "claude-sonnet"},
    "to": {"adapter": "claude-sonnet"},
    "initialPrompt": "Write a 500-word article about AI agents",
    "mode": "collaborate",
    "maxRounds": 3
  }' | jq -r '.id')

# 2. Poll until done
while true; do
  STATUS=$(curl -s http://localhost:4590/api/sessions/$SESSION_ID \
    -H "Authorization: Bearer $TOKEN" | jq -r '.status')
  [ "$STATUS" = "done" ] || [ "$STATUS" = "error" ] && break
  sleep 5
done

# 3. Get result
curl -s http://localhost:4590/api/sessions/$SESSION_ID \
  -H "Authorization: Bearer $TOKEN" | jq -r '.messages[-1].content'
```

### Delegate a writing task

When you need collaborative writing and revision:

```bash
curl -s -X POST http://localhost:4590/api/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "from": {"adapter": "claude-sonnet"},
    "to": {"adapter": "claude-sonnet"},
    "initialPrompt": "Write a professional article about [topic]. Requirements: [your requirements]. Output the final article in [RESULT]...[/RESULT] tags.",
    "mode": "collaborate",
    "maxRounds": 3,
    "context": {
      "rules": "Write in Chinese. Use first-person perspective. Keep it under 2000 words."
    }
  }'
```

---

## Conventions

- Agents should wrap their final output in `[RESULT]...[/RESULT]` tags
- Agents signal completion with `[DONE]`
- Poll interval: 5 seconds is reasonable for most tasks
- Typical session duration: 30s–5min depending on task complexity

---

## External Task Providers (extending the engine)

The Turing core is vendor-free. Any "submit a job, poll until done" integration
(rendering, video generation, batch processing) plugs in as an
`ExternalTaskProvider` instead of hard-coding into the router.

A provider participates in two flows:

1. **Inline detection** — after each agent round, `parseAgentOutput()` inspects
   the agent's text and may surface a pending job (e.g. an agent emitting a
   `submit_id`).
2. **Pipeline step takeover** — `handlePipelineStep()` fully owns a pipeline
   step whose `nodeType` is in `handledNodeTypes`, bypassing the adapter run
   loop entirely.

Minimal example:

```ts
import { Router } from 'turing'
import type { ExternalTaskProvider } from 'turing'

const myProvider: ExternalTaskProvider = {
  name: 'my-renderer',
  handledNodeTypes: ['render'],
  parseAgentOutput(content) {
    const m = content.match(/render_id:\s*([a-z0-9-]+)/i)
    return m ? { externalId: m[1], downloadDir: './output' } : undefined
  },
  async submit(args, cwd) { /* run binary, return stdout */ },
  async query(id, dir) { /* poll remote, return {status, paths?, errorMessage?} */ },
  pollIntervalMs: 15_000,
  async handlePipelineStep(hooks, sessionId) {
    /* read plan, submit, register job, or finalize + completeSession */
  },
}

const router = new Router()
router.registerExternalTaskProvider(myProvider)
```

The bundled **Dreamina** video provider (`src/examples/dreamina/`) is a complete
reference implementation — register it via `registerDreamina(router)` (the local
entry point does this by default; open-source consumers may omit it).

---

## Available Agents

To see what agents are configured:

```
GET /api/agents
```

Returns a list of available agent names and their models.
