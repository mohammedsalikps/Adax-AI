import type { Role } from '@adaxai/contracts'

/**
 * Server-side permission matrix. Every protected route declares one of these;
 * the auth hook rejects the request (403, audited) when the caller's role is
 * not listed. The web app hides controls too, but that is convenience only.
 *
 * Admins manage the platform but do not read clinical content.
 */
export const PERMISSIONS = {
  'system:status': ['admin'],
  'overview:read': ['admin'],
  'users:manage': ['admin'],
  'departments:manage': ['admin'],
  'departments:read': ['admin', 'doctor', 'nurse'],
  'staff:read': ['admin', 'doctor', 'nurse'],
  'audit:read': ['admin'],
  'devices:manage': ['admin'],
  'devices:read': ['admin', 'doctor', 'nurse'],
  'devices:assign': ['doctor', 'nurse'],
  'patients:read': ['doctor', 'nurse'],
  'patients:write': ['doctor', 'nurse'],
  'consents:write': ['doctor', 'nurse'],
  'queue:read': ['doctor', 'nurse'],
  'queue:manage': ['doctor', 'nurse'],
  'observations:write': ['doctor', 'nurse'],
  'encounters:read': ['doctor', 'nurse'],
  'encounters:write': ['doctor'],
  'encounters:sign': ['doctor'],
  'ai:use': ['doctor'],
  /** Aggregate AI operations and review metrics (no patient-level content). */
  'ai:oversight': ['admin', 'doctor'],
  'thermal:write': ['doctor', 'nurse'],
  'images:write': ['doctor', 'nurse'],
  'thermal:approve': ['doctor'],
  'thermal:label': ['doctor'],
  'thermal:export': ['doctor', 'admin'],
  'portal:self': ['patient'],
} as const satisfies Record<string, readonly Role[]>

export type Permission = keyof typeof PERMISSIONS

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role)
}
