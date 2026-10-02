import { z } from 'zod'

/** GET /api/health: liveness of the API process only (no dependencies checked). */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  service: z.literal('api'),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
  time: z.iso.datetime(),
})
export type HealthResponse = z.infer<typeof HealthResponse>

export const DependencyState = z.enum(['up', 'down'])
export type DependencyState = z.infer<typeof DependencyState>

/** GET /api/ready: 200 when the API can serve requests (database reachable), else 503. */
export const ReadyResponse = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: z.object({
      status: DependencyState,
      latencyMs: z.number().nonnegative().optional(),
      error: z.string().optional(),
    }),
  }),
})
export type ReadyResponse = z.infer<typeof ReadyResponse>

/** GET /api/system/status: aggregated view for the web shell's status panel. */
export const SystemStatusResponse = z.object({
  checkedAt: z.iso.datetime(),
  api: z.object({ status: z.literal('up'), version: z.string() }),
  database: z.object({
    status: DependencyState,
    latencyMs: z.number().nonnegative().optional(),
    serverVersion: z.string().optional(),
    encoding: z.string().optional(),
    migrationsApplied: z.number().int().nonnegative().optional(),
    error: z.string().optional(),
  }),
  thermal: z.object({
    status: DependencyState,
    latencyMs: z.number().nonnegative().optional(),
    version: z.string().optional(),
    error: z.string().optional(),
  }),
})
export type SystemStatusResponse = z.infer<typeof SystemStatusResponse>

/** GET /health on the thermal service (validated by the API before reporting it up). */
export const ThermalHealthResponse = z.object({
  status: z.literal('ok'),
  service: z.literal('thermal'),
  version: z.string(),
})
export type ThermalHealthResponse = z.infer<typeof ThermalHealthResponse>
