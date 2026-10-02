// Usage: npm run db:migrate            (dev database)
//        npm run db:migrate -- --target test|e2e
import { loadConfig, loadDotEnv } from '../config.ts'
import { migrate } from './migrator.ts'
import { createAdminClient } from './pool.ts'

loadDotEnv()
const config = loadConfig()
const target = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : 'dev'
const databases: Record<string, string> = { dev: config.db.name, test: config.db.testName, e2e: process.env.DB_E2E_NAME || 'adaxai_e2e' }
const database = target ? databases[target] : undefined
if (!database) {
  console.error(`[migrate] unknown --target "${target}" (expected dev, test or e2e)`)
  process.exit(2)
}

const client = createAdminClient(config.db, database)
try {
  await client.connect()
  const r = await migrate(client, undefined, { appRole: config.db.appUser, log: (m) => console.log(`[migrate] ${database}: ${m}`) })
  console.log(`[migrate] ${database}: ${r.applied.length} applied, ${r.skipped.length} already applied`)
} catch (e) {
  console.error(`[migrate] ${database}: ERROR ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
