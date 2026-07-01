import { OpenAIApiAdapter, type OpenAIApiAdapterConfig } from './openai.js'

const DEFAULT_MODEL = 'qwen-plus'
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

export interface QwenApiAdapterConfig extends OpenAIApiAdapterConfig {}

/**
 * Qwen (通义千问) API adapter via Alibaba DashScope. DashScope exposes an
 * OpenAI-compatible endpoint, so we reuse OpenAIApiAdapter and only override
 * the defaults (model + base URL) and the adapter name.
 */
export class QwenApiAdapter extends OpenAIApiAdapter {
  constructor(cfg: QwenApiAdapterConfig) {
    super({
      apiKey: cfg.apiKey,
      model: cfg.model ?? DEFAULT_MODEL,
      baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL,
      timeout: cfg.timeout,
    })
    this.name = 'qwen-api'
    this.config = {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
    }
  }
}
