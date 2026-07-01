import { OpenAIApiAdapter, type OpenAIApiAdapterConfig } from './openai.js'

const DEFAULT_MODEL = 'moonshot-v1-32k'
const DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1/chat/completions'

export interface MoonshotApiAdapterConfig extends OpenAIApiAdapterConfig {}

/**
 * Moonshot (Kimi) API adapter. Moonshot exposes an OpenAI-compatible
 * /chat/completions endpoint, so we reuse OpenAIApiAdapter and only override
 * the defaults (model + base URL) and the adapter name.
 */
export class MoonshotApiAdapter extends OpenAIApiAdapter {
  constructor(cfg: MoonshotApiAdapterConfig) {
    super({
      apiKey: cfg.apiKey,
      model: cfg.model ?? DEFAULT_MODEL,
      baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL,
      timeout: cfg.timeout,
    })
    this.name = 'moonshot-api'
    this.config = {
      model: this.config.model,
      baseUrl: this.config.baseUrl,
      timeout: this.config.timeout,
    }
  }
}
