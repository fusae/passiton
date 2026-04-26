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
        return await this.fetchOnce(request)
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

  protected async fetchOnce(request: ApiRequest): Promise<unknown> {
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
        return this.parseEventStream(await response.text())
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
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice('data:'.length).trim()
      if (!data || data === '[DONE]') continue
      try {
        events.push(JSON.parse(data))
      } catch {
        throw new Error(`[${this.name}] failed to parse streaming response`)
      }
    }
    return events
  }

  protected shouldRetry(err: unknown): boolean {
    if (err instanceof ApiHttpError) {
      return err.status === 429 || err.status >= 500
    }
    return err instanceof Error
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
