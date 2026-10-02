// Local recovery of a STAFF account (lockout, lost password, no administrator able to sign in).
//
//   npm run user:reset-password -- <username>
//       new random temporary password, printed once in THIS terminal;
//       the user must choose a new password at next sign-in
//   npm run user:reset-password -- <username> --seed-password
//       set the password back to SEED_DEMO_PASSWORD from .env (not printed);
//       local demo installations only
//
// In production or with clinical data (NODE_ENV=production or DATA_ORIGIN=clinical):
// --seed-password is refused, and a temporary reset needs an explicit
//   --break-glass --reason "why"
// Every reset clears the lockout, ends the user's sessions and is audited with
// the operating-system user, host and reason. Only the users and sessions
// tables are touched; patient data is not.
import os from 'node:os'
import { resetStaffPassword } from './auth/local-reset.ts'
import { loadConfig, loadDotEnv } from './config.ts'
import { createDb } from './db/client.ts'
import { createAppPool } from './db/pool.ts'

loadDotEnv()
const config = loadConfig()
const args = process.argv.slice(2)
const username = args[0]
const useSeed = args.includes('--seed-password')
const breakGlass = args.includes('--break-glass')
const reasonAt = args.indexOf('--reason')
const reason = reasonAt >= 0 ? (args[reasonAt + 1] ?? '').trim() || null : null
const protectedInstall = config.env === 'production' || config.dataOrigin === 'clinical'

if (!username || username.startsWith('--')) {
  console.error('Usage: npm run user:reset-password -- <username> [--seed-password] [--break-glass --reason "why"]')
  process.exit(2)
}
if (useSeed && protectedInstall) {
  console.error('[reset] --seed-password is only for local demo installations (refused: production or clinical data).')
  process.exit(2)
}
if (protectedInstall && (!breakGlass || !reason)) {
  console.error('[reset] This installation is production or holds clinical data. A reset here is a break-glass action: re-run with --break-glass --reason "why". It is audited with your OS user and host.')
  process.exit(2)
}

const operator = { osUser: os.userInfo().username, host: os.hostname(), reason, breakGlass }
const pool = createAppPool(config.db)
try {
  const r = await resetStaffPassword(createDb(pool), username, useSeed ? { kind: 'seed-password', seedPassword: process.env.SEED_DEMO_PASSWORD ?? '' } : { kind: 'temporary' }, operator)
  console.log(`[reset] ${r.username} (${r.role}) in database ${config.db.name}: lockout cleared, sessions ended; audited as ${operator.osUser}@${operator.host}.`)
  if (r.temporaryPassword) {
    console.log(`[reset] Temporary password (shown once, not stored anywhere): ${r.temporaryPassword}`)
    console.log('[reset] Sign in with it; you will be asked to choose a new password.')
  } else {
    console.log('[reset] Password set to SEED_DEMO_PASSWORD from .env.')
  }
} catch (e) {
  console.error(`[reset] ERROR ${(e as Error).message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
