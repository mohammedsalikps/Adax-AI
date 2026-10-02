import fs from 'node:fs'
import path from 'node:path'
import { parseEnv } from 'node:util'
import { assertDistinctNames, type DbNames } from '../apps/api/src/db/identity.ts'

/**
 * Database names for the end-to-end run, resolved exactly like the API and the
 * repo scripts resolve them (shell first, then `.env`, then defaults), so the
 * e2e server, migration, reset and seed can never disagree about which
 * database is the disposable one. Only the three name keys are read from
 * `.env`; nothing else is loaded into this process. Ambiguous names stop the
 * run before any server starts.
 */
const envFile = path.resolve(import.meta.dirname, '..', '.env')
const fromFile = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {}
const pick = (key: string, fallback: string) => process.env[key] || fromFile[key] || fallback

export const DB_NAMES: DbNames = {
  name: pick('DB_NAME', 'adaxai'),
  testName: pick('DB_TEST_NAME', 'adaxai_test'),
  e2eName: pick('DB_E2E_NAME', 'adaxai_e2e'),
}
assertDistinctNames(DB_NAMES)

export const E2E_DB = DB_NAMES.e2eName
