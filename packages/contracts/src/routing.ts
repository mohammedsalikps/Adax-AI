import { z } from 'zod'
import { Text } from './common.ts'
import { Priority } from './visits.ts'

/**
 * A deterministic routing suggestion for a visit (config/routing.yaml).
 * Suggestions only: staff apply or override them; red flags show the
 * configured instruction and are never a diagnosis or an automatic
 * emergency disposition.
 */
export const RoutingSuggestion = z.object({
  id: z.uuid(),
  visitId: z.uuid(),
  rulesVersion: z.string(),
  status: z.enum(['pending', 'applied', 'overridden', 'superseded']),
  suggestion: z.object({
    departmentId: z.uuid().nullable(),
    departmentCode: z.string(),
    departmentName: z.string().nullable(),
    priority: Priority,
    doctorId: z.uuid().nullable(),
    doctorName: z.string().nullable(),
    missingIntake: z.array(z.string()),
    redFlags: z.array(z.object({ id: z.string(), source: z.enum(['reason', 'vitals']), matched: z.string(), instruction: z.string() })),
    reasons: z.array(z.object({ rule: z.string(), text: z.string() })),
  }),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  reviewedByName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewReason: z.string().nullable(),
})
export type RoutingSuggestion = z.infer<typeof RoutingSuggestion>

export const RoutingResponse = z.object({ suggestion: RoutingSuggestion.nullable(), rulesError: z.string().nullable() })
export type RoutingResponse = z.infer<typeof RoutingResponse>

export const OverrideRoutingRequest = z.object({ reason: Text(300) })
export type OverrideRoutingRequest = z.input<typeof OverrideRoutingRequest>
