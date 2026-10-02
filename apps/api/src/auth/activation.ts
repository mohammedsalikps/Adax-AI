import crypto from 'node:crypto'
import { ActivatePatientAccountRequest } from '@adaxai/contracts'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { audit } from '../audit/audit.ts'
import { consentState } from '../consents/service.ts'
import { type Db, pgCode } from '../db/client.ts'
import { patientActivationCodes, patients, users } from '../db/schema.ts'
import { badRequest, conflict, HttpError } from '../http/errors.ts'
import { enforceLimit, type LimitRule, type RateLimiter } from '../http/rate-limit.ts'
import { parse } from '../http/validate.ts'
import { hashActivationCode } from '../patients/routes.ts'
import { fullName } from '../patients/service.ts'
import { hashPassword } from './password.ts'
import { sessionCookieOptions } from './plugin.ts'
import { toMe } from './routes.ts'
import { createSession, revokeUserSessions, SESSION_COOKIE } from './sessions.ts'

export const MAX_ACTIVATION_ATTEMPTS = 5
const INVALID = 'The MRN or activation code is not valid, or the code has expired. Ask the clinic for a new code.'

/**
 * A patient turns the one-time code from the clinic into a portal account
 * (username = MRN) and is signed in. A code issued for an existing account is
 * a reset: it sets a new password and switches the account back on. Wrong
 * codes count against the code (atomically); after MAX_ACTIVATION_ATTEMPTS it
 * is revoked. The portal consent is checked again when the code is used.
 * Errors never reveal which part was wrong.
 */
export function registerActivationRoutes(app: FastifyInstance, { db, cookieSecure, limiter, perIp }: { db: Db; cookieSecure: boolean; limiter: RateLimiter; perIp: LimitRule }) {
  app.post('/api/auth/activate', { config: { public: true } }, async (req, reply) => {
    await enforceLimit(db, limiter, req, reply, 'activation-ip', req.ip, perIp)
    const body = parse(ActivatePatientAccountRequest, req.body)
    if (body.password.toLowerCase().includes(body.mrn.toLowerCase())) {
      throw badRequest('Some fields are invalid', [{ path: 'password', message: 'Must not contain your MRN' }])
    }
    const patient = await db.query.patients.findFirst({ where: eq(patients.mrn, body.mrn) })
    const code = patient
      ? await db.query.patientActivationCodes.findFirst({
          where: and(eq(patientActivationCodes.patientId, patient.id), isNull(patientActivationCodes.usedAt), isNull(patientActivationCodes.revokedAt), sql`${patientActivationCodes.expiresAt} > now()`),
          orderBy: desc(patientActivationCodes.createdAt),
        })
      : undefined

    const supplied = Buffer.from(hashActivationCode(body.activationCode), 'hex')
    const matches = !!code && crypto.timingSafeEqual(supplied, Buffer.from(code.codeHash, 'hex'))
    if (!patient || !code || !matches) {
      if (code) {
        // One statement, so concurrent guesses cannot get past the attempt limit.
        await db
          .update(patientActivationCodes)
          .set({
            failedAttempts: sql`${patientActivationCodes.failedAttempts} + 1`,
            revokedAt: sql`case when ${patientActivationCodes.failedAttempts} + 1 >= ${MAX_ACTIVATION_ATTEMPTS} then now() else ${patientActivationCodes.revokedAt} end`,
          })
          .where(eq(patientActivationCodes.id, code.id))
      }
      await audit(db, req, { action: 'patient.portal_activate', outcome: 'failure', patientId: patient?.id ?? null, details: { reason: !patient ? 'unknown_mrn' : !code ? 'no_valid_code' : 'wrong_code' } })
      throw new HttpError(400, 'invalid_activation', INVALID)
    }

    // The code was issued with portal consent; it must still be in place now.
    const { state } = await consentState(db, patient.id, 'portal_access')
    if (state !== 'granted' && state !== 'outdated') {
      await db.update(patientActivationCodes).set({ revokedAt: sql`now()` }).where(and(eq(patientActivationCodes.id, code.id), isNull(patientActivationCodes.revokedAt)))
      await audit(db, req, { action: 'patient.portal_activate', outcome: 'failure', patientId: patient.id, details: { reason: 'portal_consent_' + state } })
      throw new HttpError(400, 'invalid_activation', INVALID)
    }

    const passwordHash = await hashPassword(body.password)
    try {
      const { user, reset } = await db.transaction(async (tx) => {
        // Use the code once (fails if it was used or revoked in the meantime).
        const [used] = await tx
          .update(patientActivationCodes)
          .set({ usedAt: sql`now()` })
          .where(and(eq(patientActivationCodes.id, code.id), isNull(patientActivationCodes.usedAt), isNull(patientActivationCodes.revokedAt)))
          .returning({ id: patientActivationCodes.id })
        if (!used) throw new HttpError(400, 'invalid_activation', INVALID)
        const existing = await tx.query.users.findFirst({ where: and(eq(users.patientId, patient.id), eq(users.role, 'patient')) })
        let u: typeof users.$inferSelect
        if (existing) {
          // Reset: new password, account switched back on, lockout cleared, old sessions end.
          const [r] = await tx
            .update(users)
            .set({ passwordHash, isActive: true, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: sql`now()`, lastLoginAt: sql`now()`, updatedAt: sql`now()` })
            .where(eq(users.id, existing.id))
            .returning()
          await revokeUserSessions(tx, existing.id)
          u = r!
        } else {
          const [r] = await tx
            .insert(users)
            .values({ facilityId: patient.facilityId, username: patient.mrn, fullName: fullName(patient), role: 'patient', patientId: patient.id, passwordHash, lastLoginAt: sql`now()` })
            .returning()
          u = r!
        }
        await audit(tx, req, {
          action: existing ? 'patient.portal_reset' : 'patient.portal_activate',
          actorUserId: u.id,
          actorRole: 'patient',
          patientId: patient.id,
          entityType: 'user',
          entityId: u.id,
          // Who issued the code, so an activation by someone other than the patient can be traced.
          details: { codeIssuedBy: code.createdBy, codeIssuedAt: code.createdAt.toISOString() },
        })
        return { user: u, reset: !!existing }
      })
      const session = await createSession(db, user.id, req.ip, req.headers['user-agent'] ?? null)
      void reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(cookieSecure, session.expiresAt))
      return reply.code(reset ? 200 : 201).send(toMe(user))
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('This patient already has a portal account. Sign in with your MRN.', 'portal_account_exists')
      throw e
    }
  })
}
