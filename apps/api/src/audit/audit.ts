import type { FastifyRequest } from 'fastify'
import type { DbOrTx } from '../db/client.ts'
import { auditEvents } from '../db/schema.ts'

export interface AuditInput {
  /** Dotted verb, e.g. `patient.read`, `encounter.sign`, `auth.login`. */
  action: string
  outcome?: 'success' | 'failure' | 'denied'
  entityType?: string
  entityId?: string | null
  patientId?: string | null
  /** Override the actor (e.g. a failed login has no session yet). */
  actorUserId?: string | null
  actorRole?: string | null
  /** Small, non-clinical context. Never put clinical free text or secrets here. */
  details?: Record<string, unknown>
}

/**
 * Appends an audit event. Pass the transaction handle when the audited change
 * is transactional, so the event commits (or rolls back) with it.
 */
export async function audit(db: DbOrTx, req: FastifyRequest | null, e: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    actorUserId: e.actorUserId !== undefined ? e.actorUserId : (req?.user?.id ?? null),
    actorRole: e.actorRole !== undefined ? e.actorRole : (req?.user?.role ?? null),
    action: e.action,
    outcome: e.outcome ?? 'success',
    entityType: e.entityType ?? null,
    entityId: e.entityId ?? null,
    patientId: e.patientId ?? null,
    requestId: req?.id ?? null,
    ip: req?.ip ?? null,
    userAgent: req?.headers['user-agent']?.slice(0, 300) ?? null,
    details: e.details ?? {},
  })
}
