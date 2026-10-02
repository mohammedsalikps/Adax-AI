import { HealthResponse, ReadyResponse, SystemStatusResponse } from '@adaxai/contracts'
import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { createAppPool } from '../src/db/pool.ts'
import { closedPort, jsonResponse, testConfig } from './helpers.ts'

const pool = createAppPool(testConfig.db)
const thermalOk = (async () => jsonResponse({ status: 'ok', service: 'thermal', version: '0.1.0', capabilities: [] })) as typeof fetch
const app = buildApp({ config: testConfig, pool, fetchImpl: thermalOk, logger: false })

afterAll(async () => {
  await app.close()
  await pool.end()
})

describe('GET /api/health', () => {
  it('returns 200 with the liveness contract', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    const body = HealthResponse.parse(res.json())
    expect(body.version).toBe(testConfig.version)
  })
})

describe('GET /api/ready', () => {
  it('returns 200 when the database is reachable', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/ready' })
    expect(res.statusCode).toBe(200)
    const body = ReadyResponse.parse(res.json())
    expect(body.status).toBe('ready')
    expect(body.checks.database.status).toBe('up')
  })

  it('returns 503 when the database is unreachable', async () => {
    const deadConfig = { ...testConfig, db: { ...testConfig.db, port: await closedPort() } }
    const deadPool = createAppPool(deadConfig.db)
    const deadApp = buildApp({ config: deadConfig, pool: deadPool, fetchImpl: thermalOk, logger: false })
    try {
      const res = await deadApp.inject({ method: 'GET', url: '/api/ready' })
      expect(res.statusCode).toBe(503)
      const body = ReadyResponse.parse(res.json())
      expect(body).toMatchObject({ status: 'not_ready', checks: { database: { status: 'down', error: 'ECONNREFUSED' } } })
    } finally {
      await deadApp.close()
      await deadPool.end()
    }
  })
})

describe('GET /api/system/status', () => {
  it('reports database details and a healthy thermal service', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/status' })
    expect(res.statusCode).toBe(200)
    const body = SystemStatusResponse.parse(res.json())
    expect(body.database.status).toBe('up')
    expect(body.database.encoding).toBe('UTF8')
    expect(body.database.serverVersion).toMatch(/^17\./)
    expect(body.database.migrationsApplied).toBeGreaterThanOrEqual(2)
    expect(body.thermal).toMatchObject({ status: 'up', version: '0.1.0' })
  })

  it('reports the thermal service down when it cannot be reached', async () => {
    const refused = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    }) as typeof fetch
    const a = buildApp({ config: testConfig, pool, fetchImpl: refused, logger: false })
    const body = SystemStatusResponse.parse((await a.inject({ method: 'GET', url: '/api/system/status' })).json())
    expect(body.thermal).toEqual({ status: 'down', error: 'ECONNREFUSED' })
    await a.close()
  })

  it('does not report the thermal service up when its response is malformed', async () => {
    const malformed = (async () => jsonResponse({ hello: 'world' })) as typeof fetch
    const a = buildApp({ config: testConfig, pool, fetchImpl: malformed, logger: false })
    const body = SystemStatusResponse.parse((await a.inject({ method: 'GET', url: '/api/system/status' })).json())
    expect(body.thermal).toEqual({ status: 'down', error: 'INVALID_RESPONSE' })
    await a.close()
  })
})

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'not_found' })
  })
})
