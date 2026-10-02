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
