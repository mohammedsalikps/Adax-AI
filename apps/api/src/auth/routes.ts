import { ChangePasswordRequest, LoginRequest, type Me } from '@adaxai/contracts'
import { eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { audit } from '../audit/audit.ts'
import type { Db } from '../db/client.ts'
import { users } from '../db/schema.ts'
import { badRequest, HttpError } from '../http/errors.ts'
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

export function registerAuthRoutes(app: FastifyInstance, deps: { db: Db; cookieSecure: boolean }) {
  const { db, cookieSecure } = deps

  app.post('/api/auth/login', { config: { public: true } }, async (req, reply) => {
    const body = parse(LoginRequest, req.body)
    const user = await db.query.users.findFirst({ where: eq(users.username, body.username) })
    const now = new Date()

    if (user?.lockedUntil && user.lockedUntil > now) {
      await audit(db, req, { action: 'auth.login', outcome: 'failure', actorUserId: user.id, actorRole: user.role, details: { username: body.username, reason: 'locked' } })
      throw new HttpError(423, 'account_locked', 'Too many failed sign-in attempts. Try again in 15 minutes or ask an administrator.')
    }

    // Always run a full verification so response time does not reveal whether the username exists.
    const ok = await verifyPassword(user?.passwordHash ?? (await dummyHash()), body.password)
    if (!user || !ok || !user.isActive) {
      if (user && user.isActive && !ok) {
        const failed = user.failedLoginCount + 1
        await db
          .update(users)
          .set(failed >= MAX_FAILED_LOGINS ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) } : { failedLoginCount: failed })
          .where(eq(users.id, user.id))
      }
      await audit(db, req, {
        action: 'auth.login',
        outcome: 'failure',
        actorUserId: user?.id ?? null,
        actorRole: user?.role ?? null,
        details: { username: body.username, reason: !user ? 'unknown_user' : !user.isActive ? 'inactive' : 'bad_password' },
      })
      throw new HttpError(401, 'invalid_credentials', 'Invalid username or password')
    }

    await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now }).where(eq(users.id, user.id))
    const session = await createSession(db, user.id, req.ip, req.headers['user-agent'] ?? null)
    void reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(cookieSecure, session.expiresAt))
    await audit(db, req, { action: 'auth.login', actorUserId: user.id, actorRole: user.role, details: { username: user.username } })
    return toMe(user)
  })

  app.post('/api/auth/logout', { config: { allowWhilePasswordChangeRequired: true } }, async (req, reply) => {
    const user = currentUser(req)
    await deleteSession(db, user.sessionId)
    void reply.clearCookie(SESSION_COOKIE, { path: '/' })
    await audit(db, req, { action: 'auth.logout' })
    return { ok: true }
  })

  app.get('/api/auth/me', { config: { allowWhilePasswordChangeRequired: true } }, async (req) => {
    const u = currentUser(req)
    return toMe(u)
  })

  app.post('/api/auth/change-password', { config: { allowWhilePasswordChangeRequired: true } }, async (req) => {
    const u = currentUser(req)
    const body = parse(ChangePasswordRequest, req.body)
    if (body.newPassword.toLowerCase().includes(u.username.toLowerCase())) {
      throw badRequest('Some fields are invalid', [{ path: 'newPassword', message: 'Must not contain your username' }])
    }
    const row = await db.query.users.findFirst({ where: eq(users.id, u.id) })
    if (!row || !(await verifyPassword(row.passwordHash, body.currentPassword))) {
      await audit(db, req, { action: 'auth.password_change', outcome: 'failure', details: { reason: 'bad_current_password' } })
      throw badRequest('Some fields are invalid', [{ path: 'currentPassword', message: 'Current password is incorrect' }])
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), mustChangePassword: false, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(users.id, u.id))
    // Other sessions of this user end; the current one continues.
    await revokeUserSessions(db, u.id, u.sessionId)
    await audit(db, req, { action: 'auth.password_change' })
    return toMe({ ...u, mustChangePassword: false })
  })
}
