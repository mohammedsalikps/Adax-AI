// Shared environment loading for the repo scripts (db, setup, thermal).
// Values come from the process environment, with `.env` at the repo root
// filling anything not already set. Secrets are never printed.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const ENV_FILE = path.join(ROOT, '.env')
export const ENV_EXAMPLE = path.join(ROOT, '.env.example')

export function loadEnv() {
  if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)
  const e = process.env
  const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10))
  return {
    db: {
      host: e.DB_HOST || '127.0.0.1',
      port: int(e.DB_PORT, 5433),
      name: e.DB_NAME || 'adaxai',
      testName: e.DB_TEST_NAME || 'adaxai_test',
      adminUser: e.DB_ADMIN_USER || 'adaxai_admin',
      adminPassword: e.DB_ADMIN_PASSWORD || '',
      appUser: e.DB_APP_USER || 'adaxai_app',
      appPassword: e.DB_APP_PASSWORD || '',
      dataDir: path.resolve(ROOT, e.DB_DATA_DIR || '.data/pg'),
    },
    thermal: {
      host: e.THERMAL_HOST || '127.0.0.1',
      port: int(e.THERMAL_PORT, 8001),
    },
    storageDir: path.resolve(ROOT, e.STORAGE_DIR || 'storage'),
  }
}

export function requireSecrets(cfg) {
  const missing = []
  if (!cfg.db.adminPassword) missing.push('DB_ADMIN_PASSWORD')
  if (!cfg.db.appPassword) missing.push('DB_APP_PASSWORD')
  if (missing.length) {
    throw new Error(`Missing ${missing.join(', ')} in .env. Run \`npm run setup\` to create .env with generated local passwords.`)
  }
}

// Role and database names are interpolated into DDL, so they are restricted to
// plain identifiers. Passwords go through pg's escapeLiteral instead.
export function assertIdentifier(name, label) {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`${label} must be a lowercase SQL identifier, got "${name}"`)
  return name
}
