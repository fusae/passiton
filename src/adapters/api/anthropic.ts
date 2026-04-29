import type { AdapterSendOpts } from '../../types.js'
import { ApiAdapter, type ApiAdapterConfig, type ApiParsedResponse, type ApiRequest } from './base.js'

const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

interface AnthropicMessage {
  role: 'user' | 'assistant'
  content: string
}

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

interface AnthropicStreamEvent {
  type?: string
  delta?: { text?: string }
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
}

export interface AnthropicApiAdapterConfig extends Partial<ApiAdapterConfig> {
  apiKey: string
}

export class AnthropicApiAdapter extends ApiAdapter {
  constructor(cfg: AnthropicApiAdapterConfig) {
    super('anthropic-api', {
      apiKey: cfg.apiKey,
      model: cfg.model ?? DEFAULT_MODEL,
      baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL,
      timeout: cfg.timeout,
    })
  }

  protected buildRequest(message: string, opts?: AdapterSendOpts): ApiRequest {
    return {
      headers: {
        'x-api-key': opts?.apiKey ?? this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: {
        model: this.model,
        max_tokens: 4096,
        stream: true,
        ...(opts?.systemPrompt ? { system: opts.systemPrompt } : {}),
        messages: buildAnthropicMessages(message, opts),
      },
    }
  }

  protected parseResponse(data: unknown): ApiParsedResponse {
    if (Array.isArray(data)) {
      let content = ''
      let inputTokens = 0
      let outputTokens = 0
      for (const event of data as AnthropicStreamEvent[]) {
        content += event.delta?.text ?? ''
        inputTokens = event.usage?.input_tokens ?? inputTokens
        outputTokens = event.usage?.output_tokens ?? outputTokens
      }
      return {
        content: content.trim(),
        tokenEstimate: inputTokens + outputTokens || undefined,
      }
    }

    const response = data as AnthropicResponse
    const content = response.content
      ?.filter((part) => part.type === 'text' && part.text)
      .map((part) => part.text)
      .join('') ?? ''
    const inputTokens = response.usage?.input_tokens ?? 0
    const outputTokens = response.usage?.output_tokens ?? 0
    return {
      content: content.trim(),
      tokenEstimate: inputTokens + outputTokens || undefined,
    }
  }
}

function buildAnthropicMessages(message: string, opts?: AdapterSendOpts): AnthropicMessage[] {
  const messages = (opts?.history ?? []).map((item) => ({
    role: item.role,
    content: item.content,
  }))
  const last = messages.at(-1)
  if (last?.role !== 'user' || last.content !== message) {
    messages.push({ role: 'user', content: message })
  }
  return mergeAdjacentRoles(messages)
}

function mergeAdjacentRoles(messages: AnthropicMessage[]): AnthropicMessage[] {
  const merged: AnthropicMessage[] = []
  for (const message of messages) {
    const previous = merged.at(-1)
    if (previous?.role === message.role) {
      previous.content = `${previous.content}\n\n${message.content}`
    } else {
      merged.push({ ...message })
    }
  }
  return merged
}
