import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { assertDisposable, assertDistinctNames, claimIdentity, readIdentity, roleForName, UnsafeDatabaseError } from '../src/db/identity.ts'
import { createAdminClient } from '../src/db/pool.ts'
import { assertTestDatabase, closedPort, testConfig } from './helpers.ts'

/**
 * The hard guard that keeps tests and test tooling away from the development
 * database. Every scenario that could destroy data runs against throwaway
 * databases created here, or against a closed port, so a regressed guard can
 * only fail, never empty a real database.
 */
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..')
const API_ROOT = path.resolve(import.meta.dirname, '..')
const created: string[] = []
const tempDirs: string[] = []

async function withAdmin<T>(db: string, fn: (c: ReturnType<typeof createAdminClient>) => Promise<T>): Promise<T> {
  const c = createAdminClient(testConfig.db, db)
  await c.connect()
  try {
    return await fn(c)
  } finally {
    await c.end()
  }
}

/** A throwaway database; `suffix` lets it pass the name rules for test/e2e databases. */
async function scratchDb(suffix = ''): Promise<string> {
  const name = `adaxai_dbsafe_${crypto.randomBytes(4).toString('hex')}${suffix}`
  await withAdmin('postgres', (c) => c.query(`CREATE DATABASE ${name}`))
  created.push(name)
  return name
}

/** A throwaway database holding one row of "data" and optionally an identity marker. */
async function scratchWithData(suffix: string, role?: 'development' | 'test' | 'e2e'): Promise<string> {
  const db = await scratchDb(suffix)
  await withAdmin(db, async (c) => {
    await c.query('CREATE TABLE public.users (id int); INSERT INTO public.users VALUES (1)')
    if (role) await claimIdentity(c, role, { claimExisting: true })
  })
  return db
}

const rowCount = (db: string) => withAdmin(db, async (c) => (await c.query('SELECT count(*)::int AS n FROM public.users')).rows[0]!.n as number)

afterAll(async () => {
  await withAdmin('postgres', async (c) => {
    for (const db of created) await c.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`)
  })
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

const NAMES = { name: 'adaxai', testName: 'adaxai_test', e2eName: 'adaxai_e2e' }

describe('database names', () => {
  it('accepts three distinct names with the disposable suffixes', () => {
    expect(() => assertDistinctNames(NAMES)).not.toThrow()
    expect(roleForName(NAMES, 'adaxai')).toBe('development')
    expect(roleForName(NAMES, 'adaxai_test')).toBe('test')
    expect(roleForName(NAMES, 'adaxai_e2e')).toBe('e2e')
    expect(roleForName(NAMES, 'other')).toBeNull()
  })

  it('refuses any ambiguous combination', () => {
    const bad = [
      { ...NAMES, testName: 'adaxai' },
      { ...NAMES, e2eName: 'adaxai' },
      { ...NAMES, e2eName: 'adaxai_test' },
      { ...NAMES, testName: 'adaxai_copy' },
      { ...NAMES, e2eName: 'adaxai_e2e_copy' },
      { ...NAMES, name: 'adaxai_test', testName: 'other_test' },
      { ...NAMES, name: 'clinic_e2e' },
    ]
    for (const n of bad) expect(() => assertDistinctNames(n), JSON.stringify(n)).toThrow(UnsafeDatabaseError)
  })
})

describe('database identity marker', () => {
  it('is claimed once, confirmed afterwards, and never changes role', async () => {
    const db = await scratchDb('_test')
    await withAdmin(db, async (c) => {
      expect(await readIdentity(c)).toBeNull()
      expect(await claimIdentity(c, 'test')).toBe('claimed')
      expect(await claimIdentity(c, 'test')).toBe('confirmed')
      await expect(claimIdentity(c, 'development')).rejects.toThrow(/identifies as "test"/)
      await expect(claimIdentity(c, 'e2e')).rejects.toThrow(UnsafeDatabaseError)
      expect(await readIdentity(c)).toBe('test')
      // A singleton: a second row cannot be added, and the role is constrained.
      await expect(c.query("INSERT INTO meta.database_identity (singleton, role) VALUES (false, 'e2e')")).rejects.toMatchObject({ code: '23514' })
    })
  })

  it('is not claimed as disposable for an unmarked database that already holds data, unless a person says so', async () => {
    const db = await scratchWithData('_test')
    await withAdmin(db, async (c) => {
      await expect(claimIdentity(c, 'test')).rejects.toThrow(/already holds data/)
      expect(await readIdentity(c)).toBeNull()
      expect(await claimIdentity(c, 'test', { claimExisting: true })).toBe('claimed')
    })
    // The development database is expected to hold data.
    const dev = await scratchWithData('')
    await withAdmin(dev, async (c) => expect(await claimIdentity(c, 'development')).toBe('claimed'))
  })

  it('assertDisposable accepts only the configured database that identifies as the expected role', async () => {
    const marked = await scratchWithData('_test', 'test')
    const devMarked = await scratchWithData('_test', 'development')
    const unmarked = await scratchWithData('_test')
    const names = (testName: string) => ({ name: 'adaxai', testName, e2eName: 'adaxai_e2e' })
    await withAdmin(marked, async (c) => {
      await expect(assertDisposable(c, names(marked), marked, 'test')).resolves.toBeUndefined()
      await expect(assertDisposable(c, names(marked), marked, 'e2e')).rejects.toThrow(/not the configured e2e database/)
      await expect(assertDisposable(c, { ...names(marked), name: marked }, marked, 'test')).rejects.toThrow(UnsafeDatabaseError)
    })
    await withAdmin(devMarked, (c) => expect(assertDisposable(c, names(devMarked), devMarked, 'test')).rejects.toThrow(/identifies as "development"/))
    await withAdmin(unmarked, (c) => expect(assertDisposable(c, names(unmarked), unmarked, 'test')).rejects.toThrow(/no identity marker/))
    expect(await rowCount(devMarked)).toBe(1)
  })

  it('the test helpers pass the guard in this run (the test database identifies as "test")', async () => {
    await expect(assertTestDatabase()).resolves.toBeUndefined()
    await withAdmin(testConfig.db.name, async (c) => expect(await readIdentity(c)).toBe('test'))
  })
})

describe('destructive entrypoints fail closed', () => {
  const node = (args: string[], env: Record<string, string>, cwd = ROOT) => {
    const r = spawnSync(process.execPath, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' })
    return { status: r.status, out: `${r.stdout}\n${r.stderr}` }
  }

  it('the test helpers refuse outside the test runner, on a database that is not "test", and on the development name', async () => {
    const script = "const m = await import('./test/helpers.ts'); await m.resetDatabase()"
    const run = (env: Record<string, string>) => node(['--import', 'tsx', '--input-type=module', '-e', script], env, API_ROOT)
    const devMarked = await scratchWithData('_test', 'development')
    const outside = run({ VITEST: '', DB_TEST_NAME: devMarked })
    expect(outside.status).not.toBe(0)
    expect(outside.out).toMatch(/only inside the test runner/)
    const wrongRole = run({ VITEST: 'true', DB_TEST_NAME: devMarked })
    expect(wrongRole.status).not.toBe(0)
    expect(wrongRole.out).toMatch(/identifies as "development"/)
    expect(await rowCount(devMarked)).toBe(1)
    // Same name as the development database: refused before any connection (nothing listens on the port).
    const sameName = run({ VITEST: 'true', DB_NAME: 'adaxai_dbsafe_dev', DB_TEST_NAME: 'adaxai_dbsafe_dev', DB_PORT: String(await closedPort()) })
    expect(sameName.status).not.toBe(0)
    expect(sameName.out).toMatch(/must all be different/)
  })

  it('`db.mjs reset` refuses ambiguous names, the development database, and databases that do not identify as the target', async () => {
    const reset = (env: Record<string, string>) => node(['scripts/db.mjs', 'reset', 'test'], env)
    const port = String(await closedPort())
    expect(reset({ DB_NAME: 'adaxai_dbsafe_x_test', DB_TEST_NAME: 'adaxai_dbsafe_x_test', DB_PORT: port }).out).toMatch(/Refusing to reset: DB_NAME, DB_TEST_NAME and DB_E2E_NAME must all be different/)
    expect(reset({ DB_TEST_NAME: 'adaxai_dbsafe_copy', DB_PORT: port }).out).toMatch(/Refusing to reset: DB_TEST_NAME must end with "_test"/)

    const devMarked = await scratchWithData('_test', 'development')
    const r1 = reset({ DB_TEST_NAME: devMarked })
    expect(r1.status).not.toBe(0)
    expect(r1.out).toMatch(/identifies as "development", not "test"/)
    expect(await rowCount(devMarked)).toBe(1)

    const unmarked = await scratchWithData('_test')
    const r2 = reset({ DB_TEST_NAME: unmarked })
    expect(r2.status).not.toBe(0)
    expect(r2.out).toMatch(/no identity marker/)
    expect(await rowCount(unmarked)).toBe(1)

    // The guard does not get in the way of a real disposable database.
    const disposable = await scratchWithData('_test', 'test')
    const r3 = reset({ DB_TEST_NAME: disposable })
    expect(r3.status, r3.out).toBe(0)
    expect(await rowCount(disposable)).toBe(0)
    await withAdmin(disposable, async (c) => expect(await readIdentity(c)).toBe('test'))
  })

  it('the migrate command refuses ambiguous names, and a database marked for another purpose before applying anything', async () => {
    const migrate = (args: string[], env: Record<string, string>) => node(['--import', 'tsx', 'src/db/migrate-cli.ts', ...args], env, API_ROOT)
    const port = String(await closedPort())
    const same = migrate(['--target', 'test'], { DB_TEST_NAME: 'adaxai_dbsafe_y', DB_NAME: 'adaxai_dbsafe_y', DB_PORT: port })
    expect([same.status, same.out]).toEqual([2, expect.stringMatching(/must all be different/)])
    // A misspelt or dangling option never falls back to the development database.
    for (const args of [['--tagret', 'test'], ['--target'], ['test'], ['--target', 'test', '--force']]) {
      const r = migrate(args, { DB_PORT: port })
      expect([r.status, r.out], args.join(' ')).toEqual([2, expect.stringMatching(/unexpected arguments|unknown --target/)])
    }
    // Options swallowed by npm (given without "--") arrive as npm_config_* variables: refused, not ignored.
    const swallowed = migrate([], { npm_config_target: 'test', DB_PORT: port })
    expect([swallowed.status, swallowed.out]).toEqual([2, expect.stringMatching(/npm_config_target is set[^]*Pass options after "--"/)])
    // The root script passes its arguments through to this command (they used to be swallowed by npm).
    const rootScripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>
    expect(rootScripts['db:migrate']).toMatch(/ --$/)

    const e2eMarked = await scratchDb('_test')
    await withAdmin(e2eMarked, (c) => claimIdentity(c, 'e2e'))
    const wrong = migrate(['--target', 'test'], { DB_TEST_NAME: e2eMarked })
    expect(wrong.status).toBe(1)
    expect(wrong.out).toMatch(/identifies as "e2e", not "test"/)
    await withAdmin(e2eMarked, async (c) => expect((await c.query("SELECT to_regclass('meta.schema_migrations') AS t")).rows[0].t).toBeNull())
  })

  it('the end-to-end configuration refuses an e2e database name equal to the development one', () => {
    // Through tsx, like the other child processes here (plain node strips types only from Node 22.18).
    const r = node(['--import', 'tsx', 'e2e/db-names.ts'], { DB_NAME: 'adaxai', DB_E2E_NAME: 'adaxai' })
    expect(r.status).not.toBe(0)
    expect(r.out).toMatch(/Refusing to continue: DB_NAME, DB_TEST_NAME and DB_E2E_NAME must all be different/)
    expect(node(['--import', 'tsx', 'e2e/db-names.ts'], { DB_E2E_NAME: 'adaxai_e2e' }).status).toBe(0)
  })

  it('storage clean-up refuses to delete files unless the database identifies as the development one', async () => {
    const testMarked = await scratchDb('_test')
    await withAdmin(testMarked, async (c) => {
      await c.query('CREATE TABLE public.files (storage_key text)')
      await claimIdentity(c, 'test')
    })
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adaxai-orphans-'))
    tempDirs.push(dir)
    fs.writeFileSync(path.join(dir, 'unreferenced.bin'), 'x')
    const r = node(['scripts/storage-orphans.mjs', '--delete'], { DB_NAME: testMarked, STORAGE_DIR: dir })
    expect(r.status).toBe(2)
    expect(r.out).toMatch(/Refusing to delete/)
    expect(fs.existsSync(path.join(dir, 'unreferenced.bin'))).toBe(true)
  })
})
