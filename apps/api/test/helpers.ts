import net from 'node:net'
import type pg from 'pg'
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify'
import { buildApp } from '../src/app.ts'
import { hashPassword } from '../src/auth/password.ts'
import { type Config, loadConfig, loadDotEnv } from '../src/config.ts'
import { createDb, type Db } from '../src/db/client.ts'
import { assertDisposable, assertDistinctNames, UnsafeDatabaseError } from '../src/db/identity.ts'
import { createAdminClient, createAppPool } from '../src/db/pool.ts'
import { departments, facilities, users } from '../src/db/schema.ts'

loadDotEnv()
const base = loadConfig()

/**
 * Same settings as development, pointed at the dedicated test database and a
 * separate file store. AI provider keys from .env are never used by tests:
 * tests that exercise AI inject test doubles explicitly, so no test can reach
 * a real provider or depend on whether a key is configured.
 */
export const testConfig: Config = {
  ...base,
  env: 'test',
  db: { ...base.db, name: base.db.testName },
  storageDir: `${base.storageDir}-test`,
  cookieSecure: false,
  ai: { ...base.ai, anthropicApiKey: undefined, stt: { ...base.ai.stt, apiKey: undefined } },
}

/** A localhost port with nothing listening on it (connections are refused). */
export async function closedPort(): Promise<number> {
  const srv = net.createServer()
  await new Promise<void>((resolve) => srv.listen(0, '127.0.0.1', resolve))
  const { port } = srv.address() as net.AddressInfo
  await new Promise<void>((resolve) => srv.close(() => resolve()))
  return port
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/**
 * Hard guard before any superuser access from tests (resetting, raw SQL): the
 * process must be a test run, the target must be the configured test database
 * (never DB_NAME) and the database must identify itself as "test". Checked
 * once per process; fails closed.
 */
let disposableChecked: Promise<void> | null = null
export function assertTestDatabase(): Promise<void> {
  disposableChecked ??= (async () => {
    if (process.env.VITEST !== 'true' || testConfig.env !== 'test') throw new UnsafeDatabaseError('superuser test helpers run only inside the test runner.')
    const names = { name: base.db.name, testName: base.db.testName, e2eName: base.db.e2eName }
    // Name checks first, so an ambiguous configuration never even connects.
    assertDistinctNames(names)
    if (testConfig.db.name === names.name) throw new UnsafeDatabaseError('the target is the development database.')
    const c = createAdminClient(testConfig.db, testConfig.db.name)
    await c.connect()
    try {
      await assertDisposable(c, names, testConfig.db.name, 'test')
    } finally {
      await c.end()
    }
  })()
  return disposableChecked
}

/**
 * Empties every application table in the test database. Runs as the cluster
 * superuser with session_replication_role = replica, which is the only way
 * past the append-only triggers on audit_events (the app role cannot do this).
 */
export async function resetDatabase(): Promise<void> {
  await assertTestDatabase()
  const c = createAdminClient(testConfig.db, testConfig.db.name)
  await c.connect()
  try {
    await c.query('SET session_replication_role = replica')
    const { rows } = await c.query<{ t: string }>("SELECT quote_ident(tablename) AS t FROM pg_tables WHERE schemaname = 'public'")
    if (rows.length) await c.query(`TRUNCATE ${rows.map((r) => r.t).join(', ')} RESTART IDENTITY CASCADE`)
  } finally {
    await c.end()
  }
}

/** Runs SQL as the superuser on the test database (for simulating time passing etc.). */
export async function adminQuery(sql: string, params: unknown[] = []) {
  await assertTestDatabase()
  const c = createAdminClient(testConfig.db, testConfig.db.name)
  await c.connect()
  try {
    return await c.query(sql, params)
  } finally {
    await c.end()
  }
}

export const TEST_PASSWORD = 'Correct-horse-42'

export interface Fixture {
  facilityId: string
  departments: { gen: string; ped: string }
  users: { admin: string; doctor: string; doctor2: string; nurse: string }
}

/** A facility, two departments and one user per staff role, all with TEST_PASSWORD. */
export async function createFixture(db: Db): Promise<Fixture> {
  const [f] = await db.insert(facilities).values({ code: 'TEST-01', name: 'Test facility' }).returning()
  const [gen, ped] = await db
    .insert(departments)
    .values([
      { facilityId: f!.id, code: 'GEN', name: 'General Medicine' },
      { facilityId: f!.id, code: 'PED', name: 'Paediatrics' },
    ])
    .returning()
  const passwordHash = await hashPassword(TEST_PASSWORD)
  const mk = (username: string, role: 'admin' | 'doctor' | 'nurse', departmentId: string | null) => ({
    facilityId: f!.id,
    username,
    fullName: `Test ${username}`,
    role,
    passwordHash,
    departmentId,
  })
  const rows = await db
    .insert(users)
    .values([mk('t.admin', 'admin', null), mk('t.doctor', 'doctor', gen!.id), mk('t.doctor2', 'doctor', ped!.id), mk('t.nurse', 'nurse', gen!.id)])
    .returning({ id: users.id, username: users.username })
  const id = (u: string) => rows.find((r) => r.username === u)!.id
  return {
    facilityId: f!.id,
    departments: { gen: gen!.id, ped: ped!.id },
    users: { admin: id('t.admin'), doctor: id('t.doctor'), doctor2: id('t.doctor2'), nurse: id('t.nurse') },
  }
}

export interface TestContext {
  app: FastifyInstance
  db: Db
  /** The application-role pool, for testing what the app role itself may do in SQL. */
  pool: pg.Pool
  close: () => Promise<void>
}

export function createTestApp(overrides: Partial<Parameters<typeof buildApp>[0]> = {}): TestContext {
  const pool = createAppPool(testConfig.db)
  const app = buildApp({ config: testConfig, pool, logger: false, ...overrides })
  return {
    app,
    db: createDb(pool),
    pool,
    close: async () => {
      await app.close()
      await pool.end()
    },
  }
}

interface CallOptions {
  cookie?: string
  body?: unknown
  query?: Record<string, string>
  /** Send the CSRF header (default true). */
  csrf?: boolean
}

export function call(app: FastifyInstance, method: InjectOptions['method'], url: string, opts: CallOptions = {}): Promise<LightMyRequestResponse> {
  const headers: Record<string, string> = {}
  if (opts.csrf !== false) headers['x-adaxai-csrf'] = '1'
  if (opts.cookie) headers.cookie = opts.cookie
  return app.inject({ method, url, headers, query: opts.query, ...(opts.body !== undefined && { payload: opts.body as InjectOptions['payload'] }) })
}

/** Signs in and returns the session cookie header value. */
export async function login(app: FastifyInstance, username: string, password = TEST_PASSWORD): Promise<string> {
  const res = await call(app, 'POST', '/api/auth/login', { body: { username, password } })
  if (res.statusCode !== 200) throw new Error(`login ${username} failed: ${res.statusCode} ${res.body}`)
  const c = res.cookies.find((x) => x.name === 'adaxai_session')
  if (!c) throw new Error('no session cookie')
  return `adaxai_session=${c.value}`
}

/** A synthetic patient registration body. */
export const samplePatient = (over: Record<string, unknown> = {}) => ({
  givenName: 'Lakshmi',
  familyName: 'Narayanan',
  dateOfBirth: '1985-04-12',
  sex: 'female',
  phone: '98400 12345',
  city: 'Chennai',
  ...over,
})
