// Passiton — entry point

import { activeAgents, loadConfig, validateExposureConfig } from './config.js'
import { AgentCatalog } from './agents.js'
import { initDb } from './state.js'
import { Router } from './router.js'
import { registerBuiltinAdapters, registerConfiguredAdapters, registerGeminiImageAdapter } from './adapters/factory.js'
import { createServer, registerPersistedUserAgents } from './server.js'
import { installGracefulShutdown } from './shutdown.js'
import { registerDreamina } from './examples/dreamina/index.js'
import { logEvent } from './event-log.js'

async function main(): Promise<void> {
  logEvent('info', 'service-starting')
  const config = loadConfig()
  validateExposureConfig(config)

  // Init persistence
  initDb(undefined, { messageRetentionMs: config.policy.messageRetentionMs })

  // Build router with policy from config
  const router = new Router(config.policy)
  const agents = activeAgents(config)
  const agentCatalog = new AgentCatalog(agents, true, true)
  await agentCatalog.discover()

  // Register adapters based on config
  registerConfiguredAdapters(router, agentCatalog.configuredAgentConfigs())
  registerBuiltinAdapters(router)
  registerPersistedUserAgents(router)
  // Register bundled experimental providers/adapters. These are local
  // conveniences; open-source consumers may omit them for a clean core.
  registerDreamina(router)
  registerGeminiImageAdapter(router)

  // Recover persisted work only after this process owns the listening port.
  // A duplicate launchd/manual instance must not mutate the shared database.
  const server = createServer(router, config.server.port, agentCatalog, config.server.host, () => {
    logEvent('info', 'service-recovery-started')
    router.recoverTasks()
    router.recoverSessions()
    router.recoverExternalJobs()
    logEvent('info', 'service-recovery-completed')
  })
  installGracefulShutdown(server)
}

main().catch((err) => {
  logEvent('error', 'service-fatal-error', {
    errorMessage: err instanceof Error ? err.message : String(err),
  })
  process.exit(1)
})
