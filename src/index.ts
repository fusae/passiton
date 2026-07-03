// Turing — entry point

import { activeAgents, loadConfig, validateExposureConfig } from './config.js'
import { AgentCatalog } from './agents.js'
import { initDb } from './state.js'
import { Router } from './router.js'
import { registerBuiltinAdapters, registerConfiguredAdapters, registerGeminiImageAdapter } from './adapters/factory.js'
import { createServer, registerPersistedUserAgents } from './server.js'
import { installGracefulShutdown } from './shutdown.js'
import { registerDreamina } from './examples/dreamina/index.js'

async function main(): Promise<void> {
  const config = loadConfig()
  validateExposureConfig(config)

  // Init persistence
  initDb(undefined, { messageRetentionMs: config.policy.messageRetentionMs })

  // Build router with policy from config
  const router = new Router(config.policy)
  const agents = activeAgents(config)
  const agentCatalog = new AgentCatalog(agents, true)
  await agentCatalog.discover()

  // Register adapters based on config
  registerConfiguredAdapters(router, agents)
  registerBuiltinAdapters(router)
  registerPersistedUserAgents(router)
  // Register bundled experimental providers/adapters. These are local
  // conveniences; open-source consumers may omit them for a clean core.
  registerDreamina(router)
  registerGeminiImageAdapter(router)
  router.recoverTasks()
  router.recoverSessions()
  router.recoverExternalJobs()

  // Start HTTP + WebSocket server
  const server = createServer(router, config.server.port, agentCatalog, config.server.host)
  installGracefulShutdown(server)
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
