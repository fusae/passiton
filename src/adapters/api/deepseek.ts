import { OpenAIApiAdapter, type OpenAIApiAdapterConfig } from './openai.js'

const DEFAULT_MODEL = 'deepseek-chat'
const DEFAULT_BASE_URL = 'https://api.deepseek.com/chat/completions'

export interface DeepSeekApiAdapterConfig extends OpenAIApiAdapterConfig {}

/**
 * DeepSeek API adapter. DeepSeek exposes an OpenAI-compatible
 * /chat/completions endpoint, so we reuse OpenAIApiAdapter and only override
 * the defaults (model + base URL) and the adapter name.
 */
export class DeepSeekApiAdapter extends OpenAIApiAdapter {
  constructor(cfg: DeepSeekApiAdapterConfig) {
    super({
      apiKey: cfg.apiKey,
      model: cfg.model ?? DEFAULT_MODEL,
      baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL,
      timeout: cfg.timeout,
    })
    this.name = 'deepseek-api'
    this.config = {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
    }
  }
}
