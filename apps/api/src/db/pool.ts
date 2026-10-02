import pg from 'pg'
import type { DbConfig } from '../config.ts'

/** Connection pool for the application role (data access only, no DDL). */
export function createAppPool(db: DbConfig, database: string = db.name): pg.Pool {
  const pool = new pg.Pool({
    host: db.host,
    port: db.port,
    user: db.appUser,
    password: db.appPassword,
    database,
    max: 10,
    connectionTimeoutMillis: 2_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 5_000,
    application_name: 'adaxai-api',
  })
  // Idle clients emit 'error' when the server goes away (e.g. `npm run db:stop`).
  // Without a listener that would crash the API; readiness reports it instead.
  pool.on('error', () => undefined)
  return pool
}

/** Single connection as the admin role, for migrations and test setup only. */
export function createAdminClient(db: DbConfig, database: string = db.name): pg.Client {
  if (!db.adminPassword) throw new Error('DB_ADMIN_PASSWORD is required for migrations (run `npm run setup`).')
  return new pg.Client({
    host: db.host,
    port: db.port,
    user: db.adminUser,
    password: db.adminPassword,
    database,
    connectionTimeoutMillis: 5_000,
    application_name: 'adaxai-migrate',
  })
}
