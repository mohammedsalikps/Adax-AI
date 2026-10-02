// Usage: npm run retention              (deletes eligible audio)
//        npm run retention -- --dry-run (counts only)
// Policy: config/adaxai.yaml retention.consultationAudioDays (0 disables).
import { loadConfig, loadDotEnv } from './config.ts'
import { createDb } from './db/client.ts'
import { createAppPool } from './db/pool.ts'
import { runRetention } from './files/retention.ts'
import { loadAppSettings } from './settings/load.ts'

loadDotEnv()
const config = loadConfig()
const pool = createAppPool(config.db)
try {
  const r = await runRetention(createDb(pool), config.storageDir, loadAppSettings(), { dryRun: process.argv.includes('--dry-run') })
  if (r.days === 0) console.log('[retention] disabled (retention.consultationAudioDays is 0)')
  else console.log(`[retention] consultation audio older than ${r.days} days after signing: ${r.candidates} eligible, ${r.dryRun ? 'dry run, nothing deleted' : `${r.deleted} deleted`}`)
} catch (e) {
  console.error(`[retention] ERROR ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
