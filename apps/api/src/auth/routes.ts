import { ChangePasswordRequest, LoginRequest, type Me } from '@adaxai/contracts'
import { and, eq, isNull, lt, lte, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { audit } from '../audit/audit.ts'
import type { Db } from '../db/client.ts'
import { users } from '../db/schema.ts'
import { consentState } from '../consents/service.ts'
import { badRequest, HttpError } from '../http/errors.ts'
import { enforceLimit, type LimitRule, type RateLimiter } from '../http/rate-limit.ts'
import { parse } from '../http/validate.ts'
import { dummyHash, hashPassword, verifyPassword } from './password.ts'
import { currentUser, sessionCookieOptions } from './plugin.ts'
import { createSession, deleteSession, revokeUserSessions, SESSION_COOKIE } from './sessions.ts'

export const MAX_FAILED_LOGINS = 5
export const LOCKOUT_MS = 15 * 60 * 1000

type UserRow = typeof users.$inferSelect

export function toMe(u: Pick<UserRow, 'id' | 'username' | 'fullName' | 'role' | 'facilityId' | 'departmentId' | 'patientId' | 'mustChangePassword'>): Me {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    facilityId: u.facilityId,
    departmentId: u.departmentId,
    patientId: u.patientId,
    mustChangePassword: u.mustChangePassword,
  }
}

export interface AuthLimits {
  limiter: RateLimiter
  rules: { loginPerIp: LimitRule; loginPerAccount: LimitRule; passwordChangePerUser: LimitRule }
}

const LOCKED = 'Too many failed sign-in attempts. Try again in 15 minutes or ask an administrator.'
const LOCK_INTERVAL = sql`make_interval(secs => ${LOCKOUT_MS / 1000})`

/**
 * Failed-attempt counting for usernames that do not exist, with the same rules
 * as the database counter for real accounts (five failures lock for 15
 * minutes, no decay), so the answers do not reveal which usernames exist.
 * Kept in memory with a size cap.
 */
class UnknownUsernames {
  private readonly m = new Map<string, { count: number; lockedUntil: number }>()
  locked(key: string) {
    return (this.m.get(key)?.lockedUntil ?? 0) > Date.now()
  }
  fail(key: string) {
    const rec = this.m.get(key) ?? { count: 0, lockedUntil: 0 }
    const next = rec.count + 1 >= MAX_FAILED_LOGINS ? { count: 0, lockedUntil: Date.now() + LOCKOUT_MS } : { count: rec.count + 1, lockedUntil: rec.lockedUntil }
    this.m.delete(key)
    this.m.set(key, next)
    if (this.m.size > 10_000) this.m.delete(this.m.keys().next().value!)
  }
}

export function registerAuthRoutes(app: FastifyInstance, deps: { db: Db; cookieSecure: boolean; limits: AuthLimits }) {
  const { db, cookieSecure, limits } = deps
  const unknown = new UnknownUsernames()

  /**
   * Reserves one failed-attempt slot BEFORE the password is checked (atomic),
   * so even a burst of concurrent guesses gets at most MAX_FAILED_LOGINS checks
   * per lockout. Returns false when the account is locked.
   */
  async function reserveAttempt(userId: string): Promise<boolean> {
    const [slot] = await db
      .update(users)
      .set({ failedLoginCount: sql`${users.failedLoginCount} + 1` })
      .where(and(eq(users.id, userId), lt(users.failedLoginCount, MAX_FAILED_LOGINS), or(isNull(users.lockedUntil), lte(users.lockedUntil, sql`now()`))))
      .returning({ n: users.failedLoginCount })
    return !!slot
  }
  /** A failed check: once the reserved count reaches the limit, the account locks and the count restarts. */
  async function recordFailure(userId: string) {
    await db
      .update(users)
      .set({
        lockedUntil: sql`case when ${users.failedLoginCount} >= ${MAX_FAILED_LOGINS} then now() + ${LOCK_INTERVAL} else ${users.lockedUntil} end`,
        failedLoginCount: sql`case when ${users.failedLoginCount} >= ${MAX_FAILED_LOGINS} then 0 else ${users.failedLoginCount} end`,
      })
      .where(eq(users.id, userId))
  }

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = parse(LoginRequest, req.body)
    // Usernames are case-insensitive (citext), so the in-memory counters use the same key.
    const username = body.username.trim().toLowerCase()
    await enforceLimit(db, limits.limiter, req, reply, 'login-ip', req.ip, limits.rules.loginPerIp)
    await enforceLimit(db, limits.limiter, req, reply, 'login-account', `${req.ip}|${username}`, limits.rules.loginPerAccount)
    const user = await db.query.users.findFirst({ where: eq(users.username, body.username) })
    const failAudit = (reason: string) =>
      // An unknown "username" is often a mistyped password, so it is never stored.
      audit(db, req, { action: 'auth.login', outcome: 'failure', actorUserId: user?.id ?? null, actorRole: user?.role ?? null, facilityId: user?.facilityId ?? null, details: { ...(user && { username: user.username }), reason } })

    // The same rules for every username, existing (active or not) or unknown.
    const slot = user ? await reserveAttempt(user.id) : !unknown.locked(username)
    if (!slot) {
      await failAudit('locked')
      throw new HttpError(423, 'account_locked', LOCKED)
    }

    // Always run a full verification so response time does not reveal whether the username exists.
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), body.password)
    // A patient account also needs the patient's portal consent.
    const portalBlocked = !!user && ok && user.isActive && user.role === 'patient' && !!user.patientId && !['granted', 'outdated'].includes((await consentState(db, user.patientId, 'portal_access')).state)
    if (!user || !ok || !user.isActive || portalBlocked) {
      if (user) await recordFailure(user.id)
      else unknown.fail(username)
      await failAudit(!user ? 'unknown_user' : !user.isActive ? 'inactive' : portalBlocked ? 'portal_consent_withdrawn' : 'bad_password')
      throw new HttpError(401, 'invalid_credentials', 'Invalid username or password')
    }

    // The reserved slot was one of the allowed guesses: a correct password signs in and clears the count.
    await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: sql`now()` }).where(eq(users.id, user.id))
    const session = await createSession(db, user.id, req.ip, req.headers['user-agent'] ?? null)
    void reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(cookieSecure, session.expiresAt))
    await audit(db, req, { action: 'auth.login', actorUserId: user.id, actorRole: user.role, facilityId: user.facilityId, details: { username: user.username } })
    return toMe(user)
  })

  app.post('/api/auth/logout', { config: { anySession: true, allowWhilePasswordChangeRequired: true } }, async (req, reply) => {
    const user = currentUser(req)
    await deleteSession(db, user.sessionId)
    void reply.clearCookie(SESSION_COOKIE, { path: '/' })
    await audit(db, req, { action: 'auth.logout' })
    return { ok: true }
  })

  app.get('/api/auth/me', { config: { anySession: true, allowWhilePasswordChangeRequired: true } }, async (req) => {
    const u = currentUser(req)
    return toMe(u)
  })

  app.post('/api/auth/change-password', { config: { anySession: true, allowWhilePasswordChangeRequired: true } }, async (req, reply) => {
    const u = currentUser(req)
    const body = parse(ChangePasswordRequest, req.body)
    if (body.newPassword.toLowerCase().includes(u.username.toLowerCase())) {
      throw badRequest('Some fields are invalid', [{ path: 'newPassword', message: 'Must not contain your username' }])
    }
    await enforceLimit(db, limits.limiter, req, reply, 'password-change', u.id, limits.rules.passwordChangePerUser)
    // Wrong current passwords count towards the same lockout as sign-in (slot reserved before the check).
    if (!(await reserveAttempt(u.id))) {
      await revokeUserSessions(db, u.id)
      void reply.clearCookie(SESSION_COOKIE, { path: '/' })
      await audit(db, req, { action: 'auth.password_change', outcome: 'failure', details: { reason: 'locked' } })
      throw new HttpError(423, 'account_locked', LOCKED)
    }
    const row = await db.query.users.findFirst({ where: eq(users.id, u.id) })
    if (!row || !(await verifyPassword(row.passwordHash, body.currentPassword))) {
      await recordFailure(u.id)
      const after = await db.query.users.findFirst({ columns: { lockedUntil: true }, where: eq(users.id, u.id) })
      const locked = !!after?.lockedUntil && after.lockedUntil > new Date()
      await audit(db, req, { action: 'auth.password_change', outcome: 'failure', details: { reason: locked ? 'locked' : 'bad_current_password' } })
      if (locked) {
        // At the limit every session of the account ends.
        await revokeUserSessions(db, u.id)
        void reply.clearCookie(SESSION_COOKIE, { path: '/' })
        throw new HttpError(423, 'account_locked', LOCKED)
      }
      throw badRequest('Some fields are invalid', [{ path: 'currentPassword', message: 'Current password is incorrect' }])
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, u.id))
    // Other sessions of this user end; the current one continues.
    await revokeUserSessions(db, u.id, u.sessionId)
    await audit(db, req, { action: 'auth.password_change' })
    return toMe({ ...u, mustChangePassword: false })
  })
}
