import { buildApp } from './app.ts'
import { loadConfig, loadDotEnv } from './config.ts'
import { createAppPool } from './db/pool.ts'

loadDotEnv()
const config = loadConfig()
const pool = createAppPool(config.db)
const app = buildApp({ config, pool })

let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await pool.end()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

try {
  await app.listen({ host: config.api.host, port: config.api.port })
} catch (e) {
  app.log.error(e)
  process.exit(1)
}
