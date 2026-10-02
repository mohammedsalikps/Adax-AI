import { execSync } from 'node:child_process'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
export const E2E_DB = process.env.DB_E2E_NAME || 'adaxai_e2e'

/**
 * Every run starts from a clean, migrated and seeded e2e database, so tests
 * never touch (or depend on) the development data.
 */
export default function globalSetup() {
  const run = (cmd: string, env: Record<string, string> = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
  run('node scripts/db.mjs start')
  run('npm run migrate --workspace @adaxai/api --silent -- --target e2e')
  run('node scripts/db.mjs reset e2e')
  run('npm run seed --workspace @adaxai/api --silent', { DB_NAME: E2E_DB })
}
