import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import WebSocket, { type RawData } from 'ws'
import type { Adapter } from './types.js'
import type { AdapterSendOpts, Session } from '../types.js'
import { buildPrompt } from './shared.js'

const DEFAULT_BASE_URL = 'http://127.0.0.1:55851'
const DEFAULT_AGENT = 'cowork'

export interface OpenWorkerAdapterConfig {
  baseUrl?: string
  agent?: string
  model?: string
  timeout?: number
}

interface OpenWorkerEvent {
  type?: string
  data?: Record<string, unknown>
}

export class OpenWorkerAdapter implements Adapter {
  readonly name = 'openworker'
  readonly config: Record<string, unknown>
  private readonly baseUrl: string
  private readonly agent: string
  private readonly model?: string
  private readonly timeout: number

  constructor(cfg: OpenWorkerAdapterConfig = {}) {
    this.baseUrl = normalizeBaseUrl(cfg.baseUrl ?? DEFAULT_BASE_URL)
    this.agent = cfg.agent?.trim() || DEFAULT_AGENT
    this.model = cfg.model?.trim() || undefined
    this.timeout = cfg.timeout ?? 600_000
    this.config = {
      baseUrl: this.baseUrl,
      agent: this.agent,
      model: this.model,
      timeout: this.timeout,
    }
  }

  async send(session: Session, message: string, opts?: AdapterSendOpts): Promise<string> {
    if (!session.cwd) {
      throw new Error('[openworker] cwd is required because OpenWorker operates on a workspace')
    }

    const workspace = session.cwd
    const prompt = buildPrompt(message, opts)
    const openWorkerSessionId = `passiton-${randomUUID()}`
    const socketUrl = this.sessionSocketUrl(openWorkerSessionId, workspace)

    return new Promise<string>((resolvePromise, rejectPromise) => {
      const socket = new WebSocket(socketUrl)
      let settled = false
      let ready = false
      let currentAssistant = ''
      let finalAssistant = ''
      let fallbackOutput = ''
      let timeoutHandle: NodeJS.Timeout | undefined

      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (timeoutHandle) clearTimeout(timeoutHandle)
        opts?.signal?.removeEventListener('abort', onAbort)
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          socket.close()
        }
        if (error) {
          rejectPromise(error)
          return
        }
        const output = (finalAssistant || currentAssistant || fallbackOutput).trim()
        if (!output) {
          rejectPromise(new Error('[openworker] turn completed without assistant output'))
          return
        }
        resolvePromise(output)
      }

      const resetTimeout = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        const extension = Math.max(0, opts?.getTimeoutExtensionMs?.() ?? 0)
        timeoutHandle = setTimeout(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'interrupt' }))
          }
          finish(new Error(`[openworker] timed out after ${this.timeout + extension}ms`))
        }, this.timeout + extension)
      }

      const emit = (text: string) => {
        if (!text) return
        fallbackOutput = text
        opts?.onOutput?.(text)
      }

      const send = (payload: Record<string, unknown>) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(payload))
        }
      }

      const onAbort = () => {
        send({ type: 'interrupt' })
        const error = new Error('The operation was aborted')
        error.name = 'AbortError'
        finish(error)
      }

      resetTimeout()
      opts?.signal?.addEventListener('abort', onAbort, { once: true })
      if (opts?.signal?.aborted) {
        onAbort()
        return
      }

      socket.on('message', (raw: RawData) => {
        resetTimeout()
        let event: OpenWorkerEvent
        try {
          event = JSON.parse(raw.toString()) as OpenWorkerEvent
        } catch {
          return
        }
        const data = event.data ?? {}

        switch (event.type) {
          case 'ready':
            if (ready) return
            ready = true
            send({ type: 'set_mode', mode: session.permissionMode === 'trusted' ? 'auto' : 'interactive' })
            send({
              type: 'user_message',
              text: prompt,
              ...(this.model ? { model: this.model } : {}),
            })
            break
          case 'assistant_delta': {
            const text = stringValue(data.text)
            currentAssistant += text
            emit(text)
            break
          }
          case 'assistant_message': {
            const text = stringValue(data.text) || currentAssistant
            if (text) {
              finalAssistant = text
              if (!currentAssistant) emit(text)
            }
            currentAssistant = ''
            break
          }
          case 'tool_proposed': {
            const name = stringValue(data.name)
            if (name) emit(`→ ${name}`)
            break
          }
          case 'tool_finished': {
            const name = stringValue(data.name)
            const status = stringValue(data.status)
            if (name) emit(`✓ ${name}${status ? ` (${status})` : ''}`)
            break
          }
          case 'permission_required':
            send({ type: 'approval', decision: session.permissionMode === 'trusted' ? 'once' : 'deny' })
            break
          case 'directory_requested': {
            const requestedPath = stringValue(data.path) || workspace
            const insideWorkspace = isWithin(workspace, requestedPath)
            const wantsWrite = Boolean(data.writable)
            const granted = insideWorkspace && (!wantsWrite || session.permissionMode === 'trusted')
            send({
              type: 'directory_response',
              granted,
              ...(granted ? { path: requestedPath } : {}),
              writable: granted && wantsWrite && session.permissionMode === 'trusted',
            })
            break
          }
          case 'plan_proposed':
            send({
              type: 'plan_response',
              approved: true,
              mode: session.permissionMode === 'trusted' ? 'auto' : 'interactive',
            })
            break
          case 'question_requested': {
            const options = Array.isArray(data.options) ? data.options : []
            const answer = typeof options[0] === 'string'
              ? options[0]
              : 'Proceed using your best judgment and the original task requirements.'
            send({ type: 'question_response', answer })
            break
          }
          case 'error':
            finish(new Error(`[openworker] ${stringValue(data.error) || stringValue(data.message) || 'unknown error'}`))
            break
          case 'turn_done':
            finish()
            break
        }
      })

      socket.on('error', (error) => {
        finish(new Error(`[openworker] WebSocket error: ${error.message}`))
      })

      socket.on('close', () => {
        if (!settled) {
          finish(new Error('[openworker] connection closed before the turn completed'))
        }
      })
    })
  }

  async healthCheck(): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeout, 5_000))
    try {
      const response = await fetch(`${this.baseUrl}/v1/health`, { signal: controller.signal })
      if (!response.ok) return false
      const body = await response.json() as { status?: string }
      return body.status === 'ok'
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private sessionSocketUrl(sessionId: string, workspace: string): string {
    const url = new URL(this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.pathname = `/ws/session/${encodeURIComponent(sessionId)}`
    url.search = new URLSearchParams({
      workspace,
      agent: this.agent,
    }).toString()
    return url.toString()
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}
