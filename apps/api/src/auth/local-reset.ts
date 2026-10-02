import crypto from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { audit } from '../audit/audit.ts'
import type { Db } from '../db/client.ts'
import { users } from '../db/schema.ts'
import { hashPassword } from './password.ts'
import { revokeUserSessions } from './sessions.ts'

export type ResetMode = { kind: 'temporary' } | { kind: 'seed-password'; seedPassword: string }

/** Who ran the command (recorded in the audit log; the CLI has no signed-in user). */
export interface Operator {
  osUser: string
  host: string
  reason: string | null
  breakGlass: boolean
}

export interface ResetResult {
  username: string
  role: string
  /** Only for `temporary`: shown once to whoever runs the command; never stored or logged. */
  temporaryPassword: string | null
  mustChangePassword: boolean
}

/** 16 characters without look-alikes (no 0/O, 1/l/I). */
function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  return Array.from(crypto.randomBytes(16), (b) => alphabet[b % alphabet.length]).join('')
}

/**
 * Local recovery for a STAFF account when no administrator can sign in
 * (forgotten password, lockout). Mirrors the admin "reset password" action:
 * new password hash, lockout cleared, all of that user's sessions ended,
 * audited. Touches only the users and sessions tables; patient accounts are
 * refused (patients use portal activation).
 */
export async function resetStaffPassword(db: Db, username: string, mode: ResetMode, operator: Operator): Promise<ResetResult> {
  const user = await db.query.users.findFirst({ where: eq(users.username, username.trim()) })
  if (!user) throw new Error(`No user named "${username}". Staff usernames: see Admin > Users, or the seeded admin, dr.meera, dr.rahul, nurse.anil.`)
  if (user.role === 'patient') throw new Error('Patient accounts cannot be reset here; patients use portal activation.')
  if (!user.isActive) throw new Error(`"${user.username}" is deactivated. Deactivation is deliberate, so this command does not undo it.`)
  if (mode.kind === 'seed-password' && mode.seedPassword.length < 10) throw new Error('SEED_DEMO_PASSWORD is not set (or shorter than 10 characters) in .env.')
  const temp = mode.kind === 'temporary' ? temporaryPassword() : null
  const passwordHash = await hashPassword(temp ?? (mode as { seedPassword: string }).seedPassword)
  const mustChangePassword = mode.kind === 'temporary'
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash, mustChangePassword, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, user.id))
    await revokeUserSessions(tx, user.id)
    await audit(tx, null, { action: 'user.password_reset', actorUserId: null, actorRole: 'local-cli', entityType: 'user', entityId: user.id, details: { username: user.username, mode: mode.kind, via: 'command line', operator: operator.osUser, host: operator.host, reason: operator.reason, breakGlass: operator.breakGlass } })
  })
  return { username: user.username, role: user.role, temporaryPassword: temp, mustChangePassword }
}
