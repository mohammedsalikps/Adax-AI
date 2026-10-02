import crypto from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type pg from 'pg'
import { registerAdminRoutes } from './admin/routes.ts'
import { registerActivationRoutes } from './auth/activation.ts'
import { registerPatientRoutes } from './patients/routes.ts'
import { registerVisitRoutes } from './visits/routes.ts'
import { registerAuth } from './auth/plugin.ts'
import { registerAuthRoutes } from './auth/routes.ts'
import type { Config } from './config.ts'
import { createDb } from './db/client.ts'
import { HttpError } from './http/errors.ts'
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
    logger: deps.logger ?? { level: 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'] },
    genReqId: () => crypto.randomUUID(),
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  })
  const db = createDb(deps.pool)
  const fetchImpl = deps.fetchImpl ?? fetch

  registerAuth(app, { db, cookieSecure: deps.config.cookieSecure })
  registerHealthRoutes(app, { config: deps.config, pool: deps.pool, fetchImpl })
  registerAuthRoutes(app, { db, cookieSecure: deps.config.cookieSecure })
  registerActivationRoutes(app, { db, cookieSecure: deps.config.cookieSecure })
  registerAdminRoutes(app, { db })
  registerPatientRoutes(app, { db })
  registerVisitRoutes(app, { db })

  app.setNotFoundHandler((req, reply) => {
    void reply.code(404).send({ error: 'not_found', message: `No route for ${req.method} ${req.url.split('?')[0]}` })
  })

  // Client errors carry a safe code/message; anything else is logged and
  // returned as a generic 500 (no stack traces, SQL or input echoed back).
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, requestId: req.id, ...(err.issues && { issues: err.issues }) })
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: 'bad_request', message: err.statusCode === 413 ? 'Request too large' : 'Malformed request', requestId: req.id })
    }
    req.log.error({ err }, 'unhandled error')
    return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong', requestId: req.id })
  })

  return app
}
