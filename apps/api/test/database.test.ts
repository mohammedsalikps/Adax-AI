import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/client.ts'
import { createAppPool } from '../src/db/pool.ts'
import { SEED_USERS, seed } from '../src/db/seed.ts'
import { resetDatabase, testConfig } from './helpers.ts'

// Runs as the application role against the migrated test database.
const pool = createAppPool(testConfig.db)
const db = createDb(pool)

beforeAll(() => resetDatabase())
afterAll(() => pool.end())

describe('test database', () => {
  it('is UTF-8 with the builtin C.UTF-8 locale', async () => {
    const { rows } = await pool.query(
      "SELECT current_setting('server_encoding') AS enc, datlocprovider AS provider, datlocale AS locale FROM pg_database WHERE datname = current_database()",
    )
    expect(rows[0]).toEqual({ enc: 'UTF8', provider: 'b', locale: 'C.UTF-8' })
  })

  it('stores and returns Devanagari, Tamil and accented text unchanged', async () => {
    const text = 'राम कुमार / முருகன் / Zoë'
    const { rows } = await pool.query('SELECT $1::text AS t, upper($2::text) AS u', [text, 'zoë'])
    expect(rows[0]).toEqual({ t: text, u: 'ZOË' })
  })
})

describe('application role privileges', () => {
  it('cannot create tables (no DDL)', async () => {
    await expect(pool.query('CREATE TABLE should_fail (id int)')).rejects.toMatchObject({ code: '42501' })
  })

  it('can read but not write the migration ledger', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM meta.schema_migrations')
    expect(rows[0].n).toBeGreaterThanOrEqual(4)
    await expect(pool.query("INSERT INTO meta.schema_migrations (name, checksum) VALUES ('x', 'y')")).rejects.toMatchObject({ code: '42501' })
  })

  it('is not a superuser', async () => {
    const { rows } = await pool.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')
    expect(rows[0].rolsuper).toBe(false)
  })
})

describe('audit trail immutability', () => {
  it('rejects UPDATE, DELETE and TRUNCATE from the application role', async () => {
    await pool.query("INSERT INTO audit_events (action) VALUES ('test.immutability')")
    await expect(pool.query("UPDATE audit_events SET action = 'tampered'")).rejects.toMatchObject({ code: '42501' })
    await expect(pool.query('DELETE FROM audit_events')).rejects.toMatchObject({ code: '42501' })
    await expect(pool.query('TRUNCATE audit_events')).rejects.toMatchObject({ code: '42501' })
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE action = 'test.immutability'")
    expect(rows[0].n).toBe(1)
  })
})

describe('seed data', () => {
  it('is idempotent and stores demo passwords hashed', async () => {
    const first = await seed(db, 'Demo-password-for-tests')
    expect(first.users).toBe(SEED_USERS.length)
    const second = await seed(db, 'Demo-password-for-tests')
    expect(second).toEqual({ facilities: 0, departments: 0, users: 0 })
    const { rows } = await db.execute(sql`select password_hash from users where username = 'admin'`)
    expect(String(rows[0]?.password_hash)).toMatch(/^\$argon2id\$/)
  })

  it('skips demo users when no demo password is configured', async () => {
    await resetDatabase()
    const r = await seed(db, undefined)
    expect(r.users).toBe(0)
    expect(r.skippedUsers).toMatch(/SEED_DEMO_PASSWORD/)
  })
})
