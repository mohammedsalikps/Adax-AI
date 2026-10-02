import { afterAll, describe, expect, it } from 'vitest'
import { createAppPool } from '../src/db/pool.ts'
import { SEED_FACILITIES, seedFacilities } from '../src/db/seed.ts'
import { testConfig } from './helpers.ts'

// Runs as the application role against the migrated test database.
const pool = createAppPool(testConfig.db)

afterAll(async () => {
  await pool.query('DELETE FROM facilities WHERE code = ANY($1)', [SEED_FACILITIES.map((f) => f.code)])
  await pool.end()
})

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
    expect(rows[0].n).toBeGreaterThanOrEqual(2)
    await expect(pool.query("INSERT INTO meta.schema_migrations (name, checksum) VALUES ('x', 'y')")).rejects.toMatchObject({ code: '42501' })
  })

  it('is not a superuser', async () => {
    const { rows } = await pool.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')
    expect(rows[0].rolsuper).toBe(false)
  })
})

describe('seed data', () => {
  it('is idempotent', async () => {
    await seedFacilities(pool)
    expect(await seedFacilities(pool)).toBe(0)
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM facilities WHERE code = $1', [SEED_FACILITIES[0]!.code])
    expect(rows[0].n).toBe(1)
  })
})
