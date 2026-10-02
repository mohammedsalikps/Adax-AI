import { z } from 'zod'
import { Role, StaffRole, Password, Username } from './auth.ts'
import { OptionalText, Text } from './common.ts'

export const UserSummary = z.object({
  id: z.uuid(),
  username: z.string(),
  fullName: z.string(),
  role: Role,
  isActive: z.boolean(),
  mustChangePassword: z.boolean(),
  departmentId: z.uuid().nullable(),
  departmentName: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  lastLoginAt: z.string().nullable(),
  lockedUntil: z.string().nullable(),
  createdAt: z.string(),
})
export type UserSummary = z.infer<typeof UserSummary>

export const CreateUserRequest = z.object({
  username: Username,
  fullName: Text(120),
  role: StaffRole,
  departmentId: z.uuid().nullable().optional(),
  registrationNumber: OptionalText(64),
  temporaryPassword: Password,
})
export type CreateUserRequest = z.infer<typeof CreateUserRequest>

export const UpdateUserRequest = z
  .object({
    fullName: Text(120),
    role: StaffRole,
    departmentId: z.uuid().nullable(),
    registrationNumber: OptionalText(64),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No changes supplied')
export type UpdateUserRequest = z.infer<typeof UpdateUserRequest>

export const ResetPasswordRequest = z.object({ temporaryPassword: Password })
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>

export const Department = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
})
export type Department = z.infer<typeof Department>

export const DepartmentInput = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[A-Za-z0-9-]+$/, 'Letters, digits or hyphen'),
  name: Text(80),
  isActive: z.boolean().optional(),
})
export type DepartmentInput = z.infer<typeof DepartmentInput>
export const DepartmentUpdate = DepartmentInput.partial()

export const AuditEvent = z.object({
  id: z.number(),
  occurredAt: z.string(),
  actorUserId: z.uuid().nullable(),
  actorUsername: z.string().nullable(),
  actorRole: z.string().nullable(),
  action: z.string(),
  outcome: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  patientId: z.uuid().nullable(),
  ip: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
})
export type AuditEvent = z.infer<typeof AuditEvent>

export const AuditQuery = z.object({
  action: z.string().trim().max(64).optional(),
  actorUserId: z.uuid().optional(),
  patientId: z.uuid().optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  /** Return events with id lower than this (keyset pagination). */
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type AuditQuery = z.infer<typeof AuditQuery>

export const AuditPage = z.object({ events: z.array(AuditEvent), nextBefore: z.number().nullable() })
export type AuditPage = z.infer<typeof AuditPage>

// ---------------------------------------------------------------------------
// Audit log integrity (hash chain, migration 0019)
// ---------------------------------------------------------------------------

/** An earlier head of the chain, recorded outside the system, to compare against. */
export const AuditChainQuery = z
  .object({
    anchorSeq: z.coerce.number().int().positive().optional(),
    anchorHash: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/, '64 lowercase hexadecimal characters')
      .optional(),
  })
  .refine((q) => (q.anchorSeq === undefined) === (q.anchorHash === undefined), 'Give both the sequence number and the hash of the anchor')
export type AuditChainQuery = z.input<typeof AuditChainQuery>

export const AuditChainProblem = z.object({
  kind: z.enum(['gap', 'broken_link', 'altered', 'unchained_event', 'legacy_changed', 'unsupported_version', 'anchor_mismatch', 'anchor_missing']),
  seq: z.number().int().nullable(),
  detail: z.string(),
})
export type AuditChainProblem = z.infer<typeof AuditChainProblem>

export const AuditChainReport = z.object({
  status: z.enum(['valid', 'invalid', 'unsupported_version', 'unverifiable']),
  checkedAt: z.string(),
  /** Events in the log; linked into the chain; from before the chain (summarised by the chain start). */
  events: z.object({ total: z.number().int(), chained: z.number().int(), beforeChain: z.number().int() }),
  /** The newest link. Recording it outside the system lets a later check detect removal of the newest events. */
  head: z.object({ seq: z.number().int(), hash: z.string(), occurredAt: z.string() }).nullable(),
  chainStart: z
    .object({ seq: z.number().int(), occurredAt: z.string(), legacyEvents: z.number().int(), legacyDigestMatches: z.boolean() })
    .nullable(),
  anchor: z.object({ seq: z.number().int(), hash: z.string(), result: z.enum(['match', 'mismatch', 'missing']) }).nullable(),
  /** The first problems found (at most 20), and how many there are in all. */
  problems: z.array(AuditChainProblem),
  problemCount: z.number().int(),
})
export type AuditChainReport = z.infer<typeof AuditChainReport>

export const AUDIT_CHAIN_LIMITS =
  'The chain shows whether logged events were changed, removed or reordered after they were written, as far as the database can show. Removing the newest events, or rewriting the whole chain with full database access, is detected only by comparing with a head recorded outside the system earlier.'
