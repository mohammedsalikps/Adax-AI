import crypto from 'node:crypto'
import type { Role } from '@adaxai/contracts'
import { and, eq, ne } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { sessions, users } from '../db/schema.ts'

export const SESSION_COOKIE = 'adaxai_session'
/** Absolute lifetime of a session. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000
/** A session unused for this long is rejected. */
export const SESSION_IDLE_MS = 60 * 60 * 1000
const TOUCH_AFTER_MS = 60 * 1000

export interface SessionUser {
  id: string
  sessionId: string
  username: string
  fullName: string
  role: Role
  facilityId: string
  departmentId: string | null
  patientId: string | null
  mustChangePassword: boolean
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

export async function createSession(db: DbOrTx, userId: string, ip: string | null, userAgent: string | null) {
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  const [row] = await db
    .insert(sessions)
    .values({ userId, tokenHash: hashToken(token), expiresAt, ip, userAgent: userAgent?.slice(0, 300) ?? null })
    .returning({ id: sessions.id })
  return { token, expiresAt, sessionId: row!.id }
}

/** Returns the signed-in user for a cookie token, or null if the session is missing, expired, idle or the user is inactive. */
export async function resolveSession(db: DbOrTx, token: string): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      facilityId: users.facilityId,
      departmentId: users.departmentId,
      patientId: users.patientId,
      mustChangePassword: users.mustChangePassword,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1)
  const s = rows[0]
  if (!s) return null
  const now = Date.now()
  if (!s.isActive || s.expiresAt.getTime() <= now || now - s.lastSeenAt.getTime() > SESSION_IDLE_MS) {
    await db.delete(sessions).where(eq(sessions.id, s.sessionId))
    return null
  }
  if (now - s.lastSeenAt.getTime() > TOUCH_AFTER_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date(now) }).where(eq(sessions.id, s.sessionId))
  }
  const { expiresAt: _e, lastSeenAt: _l, isActive: _a, ...user } = s
  return user
}

export async function deleteSession(db: DbOrTx, sessionId: string) {
  await db.delete(sessions).where(eq(sessions.id, sessionId))
}

/** Revokes every session of a user, optionally keeping one (e.g. the caller's current session). */
export async function revokeUserSessions(db: DbOrTx, userId: string, keepSessionId?: string) {
  await db.delete(sessions).where(keepSessionId ? and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)) : eq(sessions.userId, userId))
}
