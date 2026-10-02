import crypto from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type pg from 'pg'
import type { Config } from './config.ts'
import { registerHealthRoutes } from './routes/health.ts'

export interface AppDeps {
  config: Config
  pool: pg.Pool
  /** Injected so tests can simulate the thermal service; defaults to global fetch. */
  fetchImpl?: typeof fetch
  logger?: FastifyServerOptions['logger']
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logger ?? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] },
    genReqId: () => crypto.randomUUID(),
  })

  registerHealthRoutes(app, { ...deps, fetchImpl: deps.fetchImpl ?? fetch })

  app.setNotFoundHandler((req, reply) => {
    void reply.code(404).send({ error: 'not_found', message: `No route for ${req.method} ${req.url}` })
  })

  // Never leak internals (stack traces, SQL) to clients; log them instead.
  app.setErrorHandler((err: Error & { statusCode?: number }, req, reply) => {
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500
    if (status === 500) req.log.error({ err }, 'unhandled error')
    void reply.code(status).send({ error: status === 500 ? 'internal_error' : 'bad_request', requestId: req.id })
  })

  return app
}
