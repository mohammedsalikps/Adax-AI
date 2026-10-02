import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR, migrate } from '../src/db/migrator.ts'
import { createAdminClient } from '../src/db/pool.ts'
import { testConfig } from './helpers.ts'

// Each scenario gets its own throwaway database so ledgers never interfere.
const created: string[] = []
const tempDirs: string[] = []

async function scratchDb(): Promise<string> {
  const name = `adaxai_test_mig_${crypto.randomBytes(4).toString('hex')}`
  const c = createAdminClient(testConfig.db, 'postgres')
  await c.connect()
  await c.query(`CREATE DATABASE ${name}`)
  await c.end()
  created.push(name)
  return name
}

async function withAdmin<T>(db: string, fn: (c: ReturnType<typeof createAdminClient>) => Promise<T>): Promise<T> {
  const c = createAdminClient(testConfig.db, db)
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

function tempMigrations(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adaxai-mig-'))
  tempDirs.push(dir)
  for (const [name, sql] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), sql)
  return dir
}

afterAll(async () => {
  await withAdmin('postgres', async (c) => {
    for (const db of created) await c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`)
  })
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

describe('migrator with the real migrations', () => {
  it('applies all migrations once, then is a no-op', async () => {
    const db = await scratchDb()
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
    const first = await withAdmin(db, (c) => migrate(c))
    expect(first.applied).toEqual(files)
    const second = await withAdmin(db, (c) => migrate(c))
    expect(second).toEqual({ applied: [], skipped: files })

    await withAdmin(db, async (c) => {
      const ext = await c.query("SELECT extname FROM pg_extension WHERE extname IN ('pgcrypto','citext','pg_trgm') ORDER BY 1")
      expect(ext.rows.map((r) => r.extname)).toEqual(['citext', 'pg_trgm', 'pgcrypto'])
      const cols = await c.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'facilities' ORDER BY ordinal_position")
      expect(cols.rows.map((r) => r.column_name)).toEqual(['id', 'code', 'name', 'timezone', 'is_active', 'created_at', 'updated_at'])
      const ledger = await c.query('SELECT name FROM meta.schema_migrations ORDER BY name')
      expect(ledger.rows.map((r) => r.name)).toEqual(files)
    })
  })
})

describe('migrator safety', () => {
  it('rolls back a failing migration completely and keeps earlier ones', async () => {
    const db = await scratchDb()
    const dir = tempMigrations({
      '0000_ok.sql': 'CREATE TABLE ok_table (id int PRIMARY KEY);',
      '0001_broken.sql': 'CREATE TABLE half_done (id int);\nTHIS IS NOT SQL;',
    })
    await expect(withAdmin(db, (c) => migrate(c, dir))).rejects.toThrow(/0001_broken\.sql failed and was rolled back/)
    await withAdmin(db, async (c) => {
      const t = await c.query("SELECT to_regclass('ok_table') AS ok, to_regclass('half_done') AS half")
      expect(t.rows[0].ok).not.toBeNull()
      expect(t.rows[0].half).toBeNull()
      const ledger = await c.query('SELECT name FROM meta.schema_migrations')
      expect(ledger.rows.map((r) => r.name)).toEqual(['0000_ok.sql'])
    })
  })

  it('refuses to run when an applied migration was edited', async () => {
    const db = await scratchDb()
    const dir = tempMigrations({ '0000_a.sql': 'CREATE TABLE a (id int);' })
    await withAdmin(db, (c) => migrate(c, dir))
    fs.writeFileSync(path.join(dir, '0000_a.sql'), 'CREATE TABLE a (id bigint);')
    fs.writeFileSync(path.join(dir, '0001_b.sql'), 'CREATE TABLE b (id int);')
    await expect(withAdmin(db, (c) => migrate(c, dir))).rejects.toThrow(/0000_a\.sql was modified after it was applied/)
    // Nothing new was applied once the mismatch was found.
    await withAdmin(db, async (c) => {
      expect((await c.query("SELECT to_regclass('b') AS b")).rows[0].b).toBeNull()
    })
  })

  it('treats CRLF and LF versions of a migration as identical', async () => {
    const db = await scratchDb()
    const dir = tempMigrations({ '0000_a.sql': 'CREATE TABLE a (id int);\nCREATE TABLE b (id int);\n' })
    await withAdmin(db, (c) => migrate(c, dir))
    fs.writeFileSync(path.join(dir, '0000_a.sql'), 'CREATE TABLE a (id int);\r\nCREATE TABLE b (id int);\r\n')
    await expect(withAdmin(db, (c) => migrate(c, dir))).resolves.toEqual({ applied: [], skipped: ['0000_a.sql'] })
  })
})
