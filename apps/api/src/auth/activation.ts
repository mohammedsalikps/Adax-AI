import crypto from 'node:crypto'
import { ActivatePatientAccountRequest } from '@adaxai/contracts'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { audit } from '../audit/audit.ts'
import { type Db, pgCode } from '../db/client.ts'
import { patientActivationCodes, patients, users } from '../db/schema.ts'
import { badRequest, conflict, HttpError } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { hashActivationCode } from '../patients/routes.ts'
import { fullName } from '../patients/service.ts'
import { hashPassword } from './password.ts'
import { sessionCookieOptions } from './plugin.ts'
import { toMe } from './routes.ts'
import { createSession, SESSION_COOKIE } from './sessions.ts'

export const MAX_ACTIVATION_ATTEMPTS = 5
const INVALID = 'The MRN or activation code is not valid, or the code has expired. Ask the clinic for a new code.'

/**
 * A patient turns the one-time code from the clinic into a portal account
 * (username = MRN) and is signed in. Wrong codes count against the code; after
 * MAX_ACTIVATION_ATTEMPTS it is revoked. Errors never reveal which part was wrong.
 */
export function registerActivationRoutes(app: FastifyInstance, { db, cookieSecure }: { db: Db; cookieSecure: boolean }) {
  app.post('/api/auth/activate', { config: { public: true } }, async (req, reply) => {
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
        const attempts = code.failedAttempts + 1
        await db
          .update(patientActivationCodes)
          .set(attempts >= MAX_ACTIVATION_ATTEMPTS ? { failedAttempts: attempts, revokedAt: sql`now()` } : { failedAttempts: attempts })
          .where(eq(patientActivationCodes.id, code.id))
      }
      await audit(db, req, { action: 'patient.portal_activate', outcome: 'failure', patientId: patient?.id ?? null, details: { reason: !patient ? 'unknown_mrn' : !code ? 'no_valid_code' : 'wrong_code' } })
      throw new HttpError(400, 'invalid_activation', INVALID)
    }

    const passwordHash = await hashPassword(body.password)
    try {
      const user = await db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({ facilityId: patient.facilityId, username: patient.mrn, fullName: fullName(patient), role: 'patient', patientId: patient.id, passwordHash, lastLoginAt: sql`now()` })
          .returning()
        await tx.update(patientActivationCodes).set({ usedAt: sql`now()` }).where(eq(patientActivationCodes.id, code.id))
        await audit(tx, req, { action: 'patient.portal_activate', actorUserId: u!.id, actorRole: 'patient', patientId: patient.id, entityType: 'user', entityId: u!.id })
        return u!
      })
      const session = await createSession(db, user.id, req.ip, req.headers['user-agent'] ?? null)
      void reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOptions(cookieSecure, session.expiresAt))
      return reply.code(201).send(toMe(user))
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('This patient already has a portal account. Sign in with your MRN.', 'portal_account_exists')
      throw e
    }
  })
}
