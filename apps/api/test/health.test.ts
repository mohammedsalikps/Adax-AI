import { HealthResponse, ReadyResponse, SystemStatusResponse } from '@adaxai/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { createAppPool } from '../src/db/pool.ts'
import { call, closedPort, createFixture, createTestApp, jsonResponse, login, resetDatabase, testConfig } from './helpers.ts'

const thermalOk = (async () => jsonResponse({ status: 'ok', service: 'thermal', version: '0.1.0', capabilities: [] })) as typeof fetch
const ctx = createTestApp({ fetchImpl: thermalOk })
let adminCookie = ''

beforeAll(async () => {
  await resetDatabase()
  await createFixture(ctx.db)
  adminCookie = await login(ctx.app, 't.admin')
})
afterAll(() => ctx.close())

describe('GET /api/health (public)', () => {
  it('returns 200 with the liveness contract and needs no session', async () => {
    const res = await call(ctx.app, 'GET', '/api/health')
    expect(res.statusCode).toBe(200)
    expect(HealthResponse.parse(res.json()).version).toBe(testConfig.version)
  })
})

describe('GET /api/ready (public)', () => {
  it('returns 200 when the database is reachable', async () => {
    const res = await call(ctx.app, 'GET', '/api/ready')
    expect(res.statusCode).toBe(200)
    expect(ReadyResponse.parse(res.json()).checks.database.status).toBe('up')
  })

  it('returns 503 when the database is unreachable', async () => {
    const deadConfig = { ...testConfig, db: { ...testConfig.db, port: await closedPort() } }
    const deadPool = createAppPool(deadConfig.db)
    const deadApp = buildApp({ config: deadConfig, pool: deadPool, fetchImpl: thermalOk, logger: false })
    try {
      const res = await call(deadApp, 'GET', '/api/ready')
      expect(res.statusCode).toBe(503)
      expect(ReadyResponse.parse(res.json())).toMatchObject({ status: 'not_ready', checks: { database: { status: 'down', error: 'ECONNREFUSED' } } })
    } finally {
      await deadApp.close()
      await deadPool.end()
    }
  })
})

describe('GET /api/system/status (admin only)', () => {
  it('requires a session', async () => {
    expect((await call(ctx.app, 'GET', '/api/system/status')).statusCode).toBe(401)
  })

  it('reports database details and a healthy thermal service', async () => {
    const res = await call(ctx.app, 'GET', '/api/system/status', { cookie: adminCookie })
    expect(res.statusCode).toBe(200)
    const body = SystemStatusResponse.parse(res.json())
    expect(body.database).toMatchObject({ status: 'up', encoding: 'UTF8' })
    expect(body.database.serverVersion).toMatch(/^17\./)
    expect(body.database.migrationsApplied).toBeGreaterThanOrEqual(4)
    expect(body.thermal).toMatchObject({ status: 'up', version: '0.1.0' })
  })

  it('reports the thermal service down when it cannot be reached', async () => {
    const refused = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    }) as typeof fetch
    const other = createTestApp({ fetchImpl: refused })
    try {
      const cookie = await login(other.app, 't.admin')
      const body = SystemStatusResponse.parse((await call(other.app, 'GET', '/api/system/status', { cookie })).json())
      expect(body.thermal).toEqual({ status: 'down', error: 'ECONNREFUSED' })
    } finally {
      await other.close()
    }
  })

  it('does not report the thermal service up when its response is malformed', async () => {
    const other = createTestApp({ fetchImpl: (async () => jsonResponse({ hello: 'world' })) as typeof fetch })
    try {
      const cookie = await login(other.app, 't.admin')
      const body = SystemStatusResponse.parse((await call(other.app, 'GET', '/api/system/status', { cookie })).json())
      expect(body.thermal).toEqual({ status: 'down', error: 'INVALID_RESPONSE' })
    } finally {
      await other.close()
    }
  })
})

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const res = await call(ctx.app, 'GET', '/api/nope', { cookie: adminCookie })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'not_found' })
  })
})
