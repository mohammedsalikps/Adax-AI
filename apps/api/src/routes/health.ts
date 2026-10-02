import {
  type HealthResponse,
  type ReadyResponse,
  type SystemStatusResponse,
  ThermalHealthResponse,
} from '@adaxai/contracts'
import type { FastifyInstance } from 'fastify'
import type pg from 'pg'
import type { Config } from '../config.ts'

interface Deps {
  config: Config
  pool: pg.Pool
  fetchImpl: typeof fetch
}

const startedAt = Date.now()

// Error codes only (e.g. ECONNREFUSED); messages can contain host details.
const errorCode = (e: unknown) => {
  const err = e as { code?: string; name?: string }
  return err.code ?? err.name ?? 'error'
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const t0 = performance.now()
  const value = await fn()
  return { value, latencyMs: Math.round((performance.now() - t0) * 10) / 10 }
}

export function registerHealthRoutes(app: FastifyInstance, deps: Deps): void {
  const { config, pool, fetchImpl } = deps

  app.get('/api/health', { config: { public: true } }, async (): Promise<HealthResponse> => ({
    status: 'ok',
    service: 'api',
    version: config.version,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  }))

  app.get('/api/ready', { config: { public: true } }, async (_req, reply) => {
    try {
      const { latencyMs } = await timed(() => pool.query('SELECT 1'))
      const body: ReadyResponse = { status: 'ready', checks: { database: { status: 'up', latencyMs } } }
      return body
    } catch (e) {
      const body: ReadyResponse = { status: 'not_ready', checks: { database: { status: 'down', error: errorCode(e) } } }
      return reply.code(503).send(body)
    }
  })

  app.get('/api/system/status', { config: { permission: 'system:status' } }, async (): Promise<SystemStatusResponse> => {
    const [database, thermal] = await Promise.all([checkDatabase(pool), checkThermal(config.thermalUrl, fetchImpl)])
    return {
      checkedAt: new Date().toISOString(),
      api: { status: 'up', version: config.version },
      database,
      thermal,
    }
  })
}

async function checkDatabase(pool: pg.Pool): Promise<SystemStatusResponse['database']> {
  try {
    const { value, latencyMs } = await timed(() =>
      pool.query<{ version: string; encoding: string; migrations: number | null }>(
        `SELECT current_setting('server_version') AS version,
                current_setting('server_encoding') AS encoding,
                (SELECT count(*)::int FROM meta.schema_migrations) AS migrations`,
      ),
    )
    const row = value.rows[0]
    return {
      status: 'up',
      latencyMs,
      ...(row && { serverVersion: row.version, encoding: row.encoding, migrationsApplied: row.migrations ?? 0 }),
    }
  } catch (e) {
    return { status: 'down', error: errorCode(e) }
  }
}

async function checkThermal(baseUrl: string, fetchImpl: typeof fetch): Promise<SystemStatusResponse['thermal']> {
  try {
    const { value, latencyMs } = await timed(async () => {
      const res = await fetchImpl(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) })
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: `HTTP_${res.status}` })
      return ThermalHealthResponse.parse(await res.json())
    })
    return { status: 'up', latencyMs, version: value.version }
  } catch (e) {
    const err = e as { cause?: { code?: string }; name?: string }
    // Unreachable services surface as fetch TypeError with the socket error in `cause`.
    const code = err.cause?.code ?? (err.name === 'ZodError' ? 'INVALID_RESPONSE' : errorCode(e))
    return { status: 'down', error: code }
  }
}
