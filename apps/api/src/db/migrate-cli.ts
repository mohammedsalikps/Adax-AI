// Usage: npm run db:migrate            (dev database)
//        npm run db:migrate -- --target test|e2e [--claim-existing]
import { loadConfig, loadDotEnv } from '../config.ts'
import { assertDistinctNames, claimIdentity, type DbRole, readIdentity, UnsafeDatabaseError } from './identity.ts'
import { migrate } from './migrator.ts'
import { PREFLIGHTS } from './preflight.ts'
import { createAdminClient } from './pool.ts'

loadDotEnv()
const config = loadConfig()
// Fail closed on anything unexpected: a dropped or misspelt option must never fall back to the development database.
const args = process.argv.slice(2)
// Options given without "--" are swallowed by npm into npm_config_* variables: refuse rather than default to dev.
const swallowed = ['npm_config_target', 'npm_config_claim_existing'].filter((k) => process.env[k] !== undefined)
if (swallowed.length) {
  console.error(`[migrate] ${swallowed.join(', ')} is set: an option given without "--" (npm keeps it), or set in your environment or .npmrc. Pass options after "--" (npm run db:migrate -- --target test|e2e [--claim-existing]) and unset the variable.`)
  process.exit(2)
}
const remedies = PREFLIGHTS.map((p) => p.flag)
const known = (a: string, i: number) => a === '--target' || a === '--claim-existing' || remedies.includes(a) || args[i - 1] === '--target'
if (!args.every(known) || (args.includes('--target') && !args[args.indexOf('--target') + 1])) {
  console.error(`[migrate] unexpected arguments: ${args.join(' ') || '(none)'} (usage: --target dev|test|e2e [--claim-existing] [${remedies.join('] [')}])`)
  process.exit(2)
}
const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : 'dev'
const databases: Record<string, string> = { dev: config.db.name, test: config.db.testName, e2e: config.db.e2eName }
const roles: Record<string, DbRole> = { dev: 'development', test: 'test', e2e: 'e2e' }
const database = target ? databases[target] : undefined
if (!database) {
  console.error(`[migrate] unknown --target "${target}" (expected dev, test or e2e)`)
  process.exit(2)
}
try {
  assertDistinctNames(config.db)
} catch (e) {
  console.error(`[migrate] ${(e as Error).message}`)
  process.exit(2)
}

const role = roles[target ?? '']!
const client = createAdminClient(config.db, database)
try {
  await client.connect()
  // A database that says it is something else is refused before anything is applied.
  const current = await readIdentity(client)
  if (current && current !== role) throw new UnsafeDatabaseError(`this database identifies as "${current}", not "${role}".`)
  const r = await migrate(client, undefined, { appRole: config.db.appUser, resolve: args.filter((a) => remedies.includes(a)), log: (m) => console.log(`[migrate] ${database}: ${m}`) })
  console.log(`[migrate] ${database}: ${r.applied.length} applied, ${r.skipped.length} already applied`)
  // Record what this database is for.
  const identity = await claimIdentity(client, role, { claimExisting: process.argv.includes('--claim-existing') })
  console.log(`[migrate] ${database}: identity ${role} ${identity}`)
} catch (e) {
  console.error(`[migrate] ${database}: ERROR ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
