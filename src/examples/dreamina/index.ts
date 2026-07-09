/**
 * Dreamina video-pipeline provider for Turing.
 *
 * This is a bundled example of an ExternalTaskProvider. The engine core
 * (src/router.ts) stays free of any vendor: it only talks to registered
 * providers. To use Dreamina video generation, register this provider at
 * startup:
 *
 *   import { registerDreamina } from './examples/dreamina/index.js'
 *   registerDreamina(router)
 *
 * The provider is inert unless PASSITON_DREAMINA_COMMAND points at the dreamina
 * binary. src/index.ts registers it by default so the local build keeps full
 * functionality; open-source consumers may omit the call to ship a clean core.
 */
import type { Router } from '../../router.js'
import { createDreaminaProvider, type DreaminaProviderOptions } from './provider.js'

export { createDreaminaProvider } from './provider.js'
export type { DreaminaProviderOptions } from './provider.js'

export function registerDreamina(router: Router, opts: DreaminaProviderOptions = {}): void {
  router.registerExternalTaskProvider(createDreaminaProvider(opts))
}
