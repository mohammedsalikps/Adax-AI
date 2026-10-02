// Usage: npm run db:migrate            (dev database)
//        npm run db:migrate -- --target test
import { loadConfig, loadDotEnv } from '../config.ts'
import { migrate } from './migrator.ts'
import { createAdminClient } from './pool.ts'

loadDotEnv()
const config = loadConfig()
const target = process.argv.includes('--target') ? process.argv[process.argv.indexOf('--target') + 1] : 'dev'
if (target !== 'dev' && target !== 'test') {
  console.error(`[migrate] unknown --target "${target}" (expected dev or test)`)
  process.exit(2)
}
const database = target === 'test' ? config.db.testName : config.db.name

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
