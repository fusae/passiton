import type { AdapterSendOpts } from '../../types.js'
import { ApiAdapter, type ApiAdapterConfig, type ApiParsedResponse, type ApiRequest } from './base.js'

const DEFAULT_MODEL = 'gpt-4o'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1/chat/completions'

type ChatRole = 'system' | 'user' | 'assistant'

interface ChatMessage {
  role: ChatRole
  content: string
}

interface OpenAIResponse {
  choices?: Array<{ message?: { content?: string } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

interface OpenAIStreamEvent {
  choices?: Array<{ delta?: { content?: string } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
}

export interface OpenAIApiAdapterConfig extends Partial<ApiAdapterConfig> {
  apiKey: string
}

export class OpenAIApiAdapter extends ApiAdapter {
  constructor(cfg: OpenAIApiAdapterConfig) {
    super('openai-api', {
      apiKey: cfg.apiKey,
      model: cfg.model ?? DEFAULT_MODEL,
      baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL,
      timeout: cfg.timeout,
    })
  }

  protected buildRequest(message: string, opts?: AdapterSendOpts): ApiRequest {
    return {
      headers: {
        authorization: `Bearer ${opts?.apiKey ?? this.apiKey}`,
      },
      body: {
        model: this.model,
        stream: true,
        stream_options: { include_usage: true },
        messages: buildChatMessages(message, opts),
      },
    }
  }

  protected parseResponse(data: unknown): ApiParsedResponse {
    if (Array.isArray(data)) {
      let content = ''
      let tokenEstimate: number | undefined
      for (const event of data as OpenAIStreamEvent[]) {
        content += event.choices?.[0]?.delta?.content ?? ''
        tokenEstimate = usageTotal(event.usage) ?? tokenEstimate
      }
      return { content: content.trim(), tokenEstimate }
    }

    const response = data as OpenAIResponse
    return {
      content: (response.choices?.[0]?.message?.content ?? '').trim(),
      tokenEstimate: usageTotal(response.usage),
    }
  }
}

export function buildChatMessages(message: string, opts?: AdapterSendOpts): ChatMessage[] {
  const messages: ChatMessage[] = []
  if (opts?.systemPrompt) {
    messages.push({ role: 'system', content: opts.systemPrompt })
  }
  for (const item of opts?.history ?? []) {
    messages.push({ role: item.role, content: item.content })
  }
  const last = messages.at(-1)
  if (last?.role !== 'user' || last.content !== message) {
    messages.push({ role: 'user', content: message })
  }
  return messages
}

function usageTotal(usage?: OpenAIResponse['usage'] | null): number | undefined {
  if (!usage) return undefined
  return usage.total_tokens ?? (((usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0)) || undefined)
}
