// Turing — entry point

import { loadConfig } from './config.js'
import { initDb } from './state.js'
import { Router } from './router.js'
import { registerConfiguredAdapters } from './adapters/factory.js'
import { createServer } from './server.js'

async function main(): Promise<void> {
  const config = loadConfig()

  // Init persistence
  initDb()

  // Build router with policy from config
  const router = new Router(config.policy)

  // Register adapters based on config
  registerConfiguredAdapters(router, config.agents)

  // Start HTTP + WebSocket server
  createServer(router, config.server.port)
}

main().catch((err) => {
  console.error('[fatal]', err)
  process.exit(1)
})
