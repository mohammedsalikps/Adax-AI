// Usage: npm run audit:verify -- [--target dev|test|e2e] [--anchor <seq>:<hash>] [--json]
//
// Checks the audit log's hash chain and prints its head. Record the head
// (seq and hash) somewhere outside this system; passing it back later as
// --anchor detects removal of the newest events or a rewrite of the chain.
// Read-only: connects as the application role and only runs SELECTs.
// Exit code 0: valid; 1: invalid, unsupported or unverifiable; 2: usage.
import { loadConfig, loadDotEnv } from '../config.ts'
import { createDb } from '../db/client.ts'
import { createAppPool } from '../db/pool.ts'
import { verifyAuditChain } from './chain.ts'

loadDotEnv()
const config = loadConfig()
const usage = () => {
  console.error('usage: npm run audit:verify -- [--target dev|test|e2e] [--anchor <seq>:<64 hex characters>] [--json]')
  process.exit(2)
}
// Strict: an option npm swallowed (given without "--") or a misspelt one must never be silently ignored,
// or a requested anchor comparison would not happen while the output still says VALID.
const swallowed = ['npm_config_anchor', 'npm_config_target', 'npm_config_json'].filter((k) => process.env[k] !== undefined)
if (swallowed.length) {
  console.error(`[audit] ${swallowed.join(', ')} is set: an option given without "--" (npm keeps it), or set in your environment or .npmrc. Unset it and pass options after "--".`)
  usage()
}
const args = process.argv.slice(2)
const opts: Record<string, string> = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]!
  if (a === '--json') opts.json = 'true'
  else if ((a === '--target' || a === '--anchor') && args[i + 1] && !args[i + 1]!.startsWith('--')) opts[a.slice(2)] = args[++i]!
  else usage()
}
const target = opts.target ?? 'dev'
const database = ({ dev: config.db.name, test: config.db.testName, e2e: config.db.e2eName } as Record<string, string>)[target]
const anchorMatch = opts.anchor ? /^(\d+):([0-9a-f]{64})$/.exec(opts.anchor) : null
if (!database || (opts.anchor && !anchorMatch)) usage()

const pool = createAppPool(config.db, database)
try {
  const report = await verifyAuditChain(createDb(pool), anchorMatch ? { seq: Number(anchorMatch[1]), hash: anchorMatch[2]! } : undefined)
  if (opts.anchor && !report.anchor) throw new Error('the anchor was not compared')
  if (opts.json) console.log(JSON.stringify(report, null, 2))
  else {
    console.log(`[audit] ${database}: ${report.status.toUpperCase()}`)
    console.log(`[audit] events: ${report.events.total} (${report.events.chained} in the chain, ${report.events.beforeChain} from before it)`)
    if (report.chainStart) console.log(`[audit] chain started at event ${report.chainStart.seq} (${report.chainStart.occurredAt}); earlier events ${report.chainStart.legacyDigestMatches ? 'unchanged' : 'CHANGED'}`)
    if (report.anchor) console.log(`[audit] anchor ${report.anchor.seq}: ${report.anchor.result}`)
    for (const p of report.problems) console.log(`[audit] problem (${p.kind}${p.seq === null ? '' : ` at ${p.seq}`}): ${p.detail}`)
    if (report.problemCount > report.problems.length) console.log(`[audit] ... ${report.problemCount - report.problems.length} more problem(s)`)
    if (report.head) console.log(`[audit] head: --anchor ${report.head.seq}:${report.head.hash}  (record this outside the system)`)
  }
  process.exitCode = report.status === 'valid' ? 0 : 1
} catch (e) {
  console.error(`[audit] ${database}: ERROR ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
