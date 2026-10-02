import crypto from 'node:crypto'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import type pg from 'pg'
import { registerAdminRoutes } from './admin/routes.ts'
import { type AiProviders, providersFromConfig } from './ai/providers.ts'
import { JobService } from './ai/jobs.ts'
import { registerOversightRoutes } from './ai/oversight.ts'
import { type JobExecutor, registerAiRoutes } from './ai/routes.ts'
import { effectiveSettings, loadAppSettings, RoutingRulesSource } from './settings/load.ts'
import type { AppSettings } from './settings/schema.ts'
import { registerFileRoutes } from './files/routes.ts'
import { httpThermalService, type ThermalService } from './thermal/client.ts'
import { registerImageRoutes } from './images/routes.ts'
import { registerDeviceRoutes } from './devices/routes.ts'
import { registerPortalRoutes } from './portal/routes.ts'
import { registerRoutingRoutes } from './routing/routes.ts'
import { registerThermalDatasetRoutes } from './thermal/datasets.ts'
import { registerThermalRoutes } from './thermal/routes.ts'
import { registerActivationRoutes } from './auth/activation.ts'
import { encounterIdsForVisits } from './encounters/service.ts'
import { registerEncounterRoutes } from './encounters/routes.ts'
import { registerInsertionRoutes } from './encounters/insertions.ts'
import { registerManaRoutes } from './mana/routes.ts'
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
  /** AI providers; tests inject fakes. Defaults to the configured real providers (or none). */
  ai?: AiProviders
  /** Thermal processing service; tests inject a fake. Defaults to the HTTP service at THERMAL_URL. */
  thermal?: ThermalService
  /** config/adaxai.yaml; tests may pass their own. */
  settings?: AppSettings
  /** config/routing.yaml (re-read on change). */
  routing?: RoutingRulesSource
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

  void app.register(multipart, { limits: { fileSize: deps.config.maxUploadBytes, files: 1, fields: 8 } })
  registerAuth(app, { db, cookieSecure: deps.config.cookieSecure })
  registerHealthRoutes(app, { config: deps.config, pool: deps.pool, fetchImpl })
  registerAuthRoutes(app, { db, cookieSecure: deps.config.cookieSecure })
  registerActivationRoutes(app, { db, cookieSecure: deps.config.cookieSecure })
  registerAdminRoutes(app, { db })
  registerPatientRoutes(app, { db })
  registerVisitRoutes(app, { db, encounterLookup: encounterIdsForVisits })
  registerEncounterRoutes(app, { db })
  registerInsertionRoutes(app, { db })
  registerFileRoutes(app, { db, config: deps.config })
  const settings = effectiveSettings(deps.settings ?? loadAppSettings(), deps.config)
  const routing = deps.routing ?? new RoutingRulesSource(undefined, (m) => app.log.error(`routing.yaml: ${m} (previous rules kept)`))
  const providers = deps.ai ?? providersFromConfig(deps.config, settings)
  const jobs = new JobService({ db, dataOrigin: deps.config.dataOrigin, aiSettings: { ai: settings.ai, uploads: settings.uploads, safety: settings.safety, mana: settings.mana } })
  const executors = new Map<string, JobExecutor>()
  const thermal = deps.thermal ?? httpThermalService(deps.config.thermalUrl, fetchImpl)
  registerAiRoutes(app, { db, config: deps.config, providers, settings, routing, jobs, executors })
  registerManaRoutes(app, { db, providers, settings, jobs, executors, dataOrigin: deps.config.dataOrigin })
  registerImageRoutes(app, { db, config: deps.config, settings, providers, thermal, jobs, executors })
  registerThermalRoutes(app, { db, config: deps.config, thermal })
  registerThermalDatasetRoutes(app, { db, config: deps.config, thermal })
  registerRoutingRoutes(app, { db, routing })
  registerOversightRoutes(app, { db, providers, jobs })
  registerPortalRoutes(app, { db })
  registerDeviceRoutes(app, { db, config: deps.config, settings })

  // API responses carry patient data: never store them in any cache (browser,
  // proxy or the web app's service worker), and set basic security headers.
  app.addHook('onSend', async (_req, reply) => {
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store')
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('x-frame-options', 'DENY')
  })

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
