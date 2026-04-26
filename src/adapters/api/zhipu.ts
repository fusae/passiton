import { OpenAIApiAdapter, type OpenAIApiAdapterConfig } from './openai.js'

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
}
