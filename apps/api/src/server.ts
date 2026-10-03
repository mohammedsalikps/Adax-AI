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

// Speech-to-text is local only. A key set for the old hosted option is not used, and the server says so (no value is printed).
if (config.ai.hostedSttKeyIgnored) app.log.warn('AI_STT_API_KEY is set but is no longer used: speech-to-text runs only on this machine (SPEECH_PROVIDER=local). Remove the key from your environment.')

try {
  await app.listen({ host: config.api.host, port: config.api.port })
} catch (e) {
  app.log.error(e)
  process.exit(1)
}
