import { z } from 'zod'
import { Text } from './common.ts'

export const Role = z.enum(['admin', 'doctor', 'nurse', 'patient'])
export type Role = z.infer<typeof Role>
export const StaffRole = z.enum(['admin', 'doctor', 'nurse'])
export type StaffRole = z.infer<typeof StaffRole>

export const ROLE_LABELS: Record<Role, string> = { admin: 'Admin', doctor: 'Doctor', nurse: 'Nurse', patient: 'Patient' }

/**
 * The three applications a person can enter ADAXAI through. This is the
 * product's front door, not its security boundary: every API route still
 * enforces role, facility and consent on every request. The roles each
 * application admits are listed here so that the API (which refuses a sign-in
 * through the wrong door before any session exists) and the web app (which
 * routes by the signed-in role) agree.
 */
export const APPLICATIONS = ['doctor', 'patient', 'admin'] as const
export const Application = z.enum(APPLICATIONS)
export type Application = z.infer<typeof Application>

/** Doctors and nurses are both clinical staff and use the clinical application ("Doctor App"); each lands in their own workspace. */
export const APPLICATION_ROLES: Record<Application, readonly Role[]> = {
  doctor: ['doctor', 'nurse'],
  patient: ['patient'],
  admin: ['admin'],
}

export const APPLICATION_LABELS: Record<Application, string> = { doctor: 'Doctor App', patient: 'Patient App', admin: 'Admin App' }

/** The application a role belongs to. */
export const applicationOf = (role: Role): Application => (role === 'admin' ? 'admin' : role === 'patient' ? 'patient' : 'doctor')

/** Password policy (NIST 800-63B style: length over composition rules). */
export const Password = z.string().min(10, 'At least 10 characters').max(128, 'At most 128 characters')

export const Username = z
  .string()
  .trim()
  .min(3, 'At least 3 characters')
  .max(64, 'At most 64 characters')
  .regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, dot, underscore or hyphen only')

export const LoginRequest = z.object({
  username: z.string().trim().min(1, 'Required').max(64),
  password: z.string().min(1, 'Required').max(128),
  /** The application the person is signing in to. When given, an account of another role is refused (403) before any session exists. */
  application: Application.optional(),
})
export type LoginRequest = z.infer<typeof LoginRequest>

export const ChangePasswordRequest = z
  .object({ currentPassword: z.string().min(1, 'Required').max(128), newPassword: Password })
  .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'Choose a different password' })
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequest>

export const Me = z.object({
  id: z.uuid(),
  username: z.string(),
  fullName: z.string(),
  role: Role,
  facilityId: z.uuid(),
  /** The clinic's name and the user's department, for the header. */
  facilityName: z.string(),
  departmentId: z.uuid().nullable(),
  departmentName: z.string().nullable(),
  patientId: z.uuid().nullable(),
  mustChangePassword: z.boolean(),
})
export type Me = z.infer<typeof Me>

export const ActivatePatientAccountRequest = z.object({
  mrn: Text(32),
  activationCode: z.string().trim().min(6).max(32),
  password: Password,
})
export type ActivatePatientAccountRequest = z.infer<typeof ActivatePatientAccountRequest>
