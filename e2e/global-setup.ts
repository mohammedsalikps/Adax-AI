import { execSync } from 'node:child_process'
import path from 'node:path'
import { E2E_DB } from './db-names.ts'

const ROOT = path.resolve(import.meta.dirname, '..')
export { E2E_DB }

/**
 * Every run starts from a clean, migrated and seeded e2e database, so tests
 * never touch (or depend on) the development data. Every step is given the
 * same resolved e2e database name; the reset refuses unless that database
 * identifies itself as the e2e database (scripts/db.mjs).
 */
export default function globalSetup() {
  const run = (cmd: string, env: Record<string, string> = {}) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, DB_E2E_NAME: E2E_DB, ...env } })
  run('node scripts/db.mjs start')
  run('npm run migrate --workspace @adaxai/api --silent -- --target e2e')
  run('node scripts/db.mjs reset e2e')
  run('npm run seed --workspace @adaxai/api --silent', { DB_NAME: E2E_DB })
}
