import type { Adapter, AdapterResponse } from '../types.js'
import type { AdapterSendOpts, Session } from '../../types.js'

export interface ApiAdapterConfig {
  apiKey: string
  model: string
  baseUrl: string
  timeout?: number
}

export interface ApiRequest {
  path?: string
  headers?: Record<string, string>
  body: Record<string, unknown>
}

export interface ApiParsedResponse {
  content: string
  tokenEstimate?: number
}

export class ApiHttpError extends Error {
  constructor(
    readonly adapterName: string,
    readonly status: number,
    readonly body: string
  ) {
    super(`[${adapterName}] API request failed with status ${status}: ${body}`)
  }
}

export abstract class ApiAdapter implements Adapter {
  config: Record<string, unknown>
  protected readonly apiKey: string
  protected readonly model: string
  protected readonly baseUrl: string
  protected readonly timeout: number
  protected readonly maxRetries = 3
  protected retryDelayMs = 500

  constructor(
    public name: string,
    cfg: ApiAdapterConfig
  ) {
    this.apiKey = cfg.apiKey
    this.model = cfg.model
    this.baseUrl = cfg.baseUrl.replace(/\/$/, '')
    this.timeout = cfg.timeout ?? 120_000
    this.config = {
      model: this.model,
      baseUrl: this.baseUrl,
      timeout: this.timeout,
    }
  }

  async send(_session: Session, message: string, opts?: AdapterSendOpts): Promise<AdapterResponse> {
    const startedAt = Date.now()
    const request = this.buildRequest(message, opts)
    const data = await this.fetchWithRetry(request, opts)
    const parsed = this.parseResponse(data)
    return {
      content: parsed.content,
      metadata: {
        duration: Date.now() - startedAt,
        tokenEstimate: parsed.tokenEstimate,
      },
    }
  }

  async healthCheck(): Promise<boolean> {
    return this.apiKey.trim().length > 0 && this.model.trim().length > 0
  }

  protected abstract buildRequest(message: string, opts?: AdapterSendOpts): ApiRequest
  protected abstract parseResponse(data: unknown): ApiParsedResponse

  protected async fetchWithRetry(request: ApiRequest, opts?: AdapterSendOpts): Promise<unknown> {
    let lastErr: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        return await this.fetchOnce(request, opts)
      } catch (err) {
        lastErr = err
        if (!this.shouldRetry(err) || attempt === this.maxRetries) break
        const delay = this.retryDelayMs * 2 ** attempt
        opts?.onOutput?.(`API retry ${attempt + 1}/${this.maxRetries} after ${delay}ms`)
        await sleep(delay)
      }
    }
    throw lastErr
  }

  protected async fetchOnce(request: ApiRequest, opts?: AdapterSendOpts): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeout)
    try {
      const response = await fetch(`${this.baseUrl}${request.path ?? ''}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...request.headers,
        },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new ApiHttpError(this.name, response.status, await response.text())
      }

      const contentType = response.headers.get('content-type') ?? ''
      if (contentType.includes('text/event-stream')) {
        return this.readEventStream(response, opts)
      }
      return response.json()
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`[${this.name}] API request timed out after ${this.timeout}ms`)
      }
      throw err
    } finally {
      clearTimeout(timer)
    }
  }

  protected parseEventStream(text: string): unknown[] {
    const events: unknown[] = []
    for (const block of text.split(/\r?\n\r?\n/)) {
      const event = this.parseEventBlock(block)
      if (event !== undefined) events.push(event)
    }
    return events
  }

  protected streamingOutput(event: unknown): string | undefined {
    if (!event || typeof event !== 'object') return undefined
    const data = event as {
      choices?: Array<{ delta?: { content?: string } }>
      delta?: { text?: string }
    }
    return data.choices?.[0]?.delta?.content ?? data.delta?.text
  }

  protected shouldRetry(err: unknown): boolean {
    if (err instanceof ApiHttpError) {
      return err.status === 429 || err.status >= 500
    }
    return err instanceof Error
  }

  private async readEventStream(response: Response, opts?: AdapterSendOpts): Promise<unknown[]> {
    if (!response.body) {
      return this.parseEventStream(await response.text())
    }

    const events: unknown[] = []
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      buffer = this.consumeEventBuffer(buffer, events, opts)
    }

    buffer += decoder.decode()
    this.consumeEventBuffer(`${buffer}\n\n`, events, opts)
    return events
  }

  private consumeEventBuffer(buffer: string, events: unknown[], opts?: AdapterSendOpts): string {
    let remaining = buffer
    while (true) {
      const match = /\r?\n\r?\n/.exec(remaining)
      if (!match) return remaining

      const block = remaining.slice(0, match.index)
      remaining = remaining.slice(match.index + match[0].length)
      const event = this.parseEventBlock(block)
      if (event === undefined) continue

      events.push(event)
      const output = this.streamingOutput(event)
      if (output) opts?.onOutput?.(output)
    }
  }

  private parseEventBlock(block: string): unknown | undefined {
    const dataLines = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice('data:'.length).trim())

    if (dataLines.length === 0) return undefined

    const data = dataLines.join('\n').trim()
    if (!data || data === '[DONE]') return undefined

    try {
      return JSON.parse(data)
    } catch {
      throw new Error(`[${this.name}] failed to parse streaming response`)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
