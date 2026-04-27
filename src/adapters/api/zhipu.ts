import { OpenAIApiAdapter, type OpenAIApiAdapterConfig } from './openai.js'
import { ApiHttpError } from './base.js'

const DEFAULT_MODEL = 'glm-4-flash'
const DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions'

export interface ZhipuApiAdapterConfig extends OpenAIApiAdapterConfig {}

export class ZhipuApiAdapter extends OpenAIApiAdapter {
  constructor(cfg: ZhipuApiAdapterConfig) {
    super({
      apiKey: cfg.apiKey,
      model: cfg.model ?? DEFAULT_MODEL,
      baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL,
      timeout: cfg.timeout,
    })
    this.name = 'zhipu-api'
    this.config = {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
    }
  }

  protected shouldRetry(err: unknown): boolean {
    const code = zhipuErrorCode(err)
    if (code !== undefined) {
      return code === 1000 || code === 1001
    }
    return super.shouldRetry(err)
  }
}

function zhipuErrorCode(err: unknown): number | undefined {
  if (!(err instanceof ApiHttpError)) return undefined

  try {
    const body = JSON.parse(err.body) as {
      error?: { code?: number | string }
      code?: number | string
    }
    const raw = body.error?.code ?? body.code
    const code = typeof raw === 'string' ? Number(raw) : raw
    return Number.isFinite(code) ? code : undefined
  } catch {
    return undefined
  }
}
