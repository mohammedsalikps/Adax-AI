import crypto from 'node:crypto'
import { CONSENT_LABELS, CONSENT_VERSIONS, type ConsentState, type ConsentType } from '@adaxai/contracts'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { audit } from '../audit/audit.ts'
import { revokeUserSessions } from '../auth/sessions.ts'
import { type DbOrTx, pgCode } from '../db/client.ts'
import { consents, deviceAssignments, encounters, patientActivationCodes, transcripts, users } from '../db/schema.ts'
import { conflict, HttpError } from '../http/errors.ts'

export type ConsentRow = typeof consents.$inferSelect

/**
 * Consent decisions in one place. A consent is for one purpose (type); it is
 * ongoing or for one consultation; it is granted with the wording version that
 * was read to the patient, and it ends once: withdrawn (who, when, why, how)
 * or superseded by a renewal under newer wording. Rows are never deleted or
 * rewritten (database trigger, migration 0017), and at most one ongoing grant
 * per patient and purpose is active (unique index).
 */

/**
 * The grant that applies now, if any: current wording first, then the most recent (deterministic).
 * `lock`: inside a transaction, also locks that grant against a withdrawal until the transaction ends, so a step that stores something because
 * the consent holds and a withdrawal that is ending recordings cannot pass each other: either the step commits first (and the withdrawal then
 * sees what it stored) or the withdrawal commits first (and the step is refused).
 */
export async function currentConsent(db: DbOrTx, patientId: string, type: ConsentType, encounterId?: string, lock = false): Promise<ConsentRow | null> {
  const query = db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.patientId, patientId),
        eq(consents.type, type),
        eq(consents.status, 'granted'),
        encounterId ? or(eq(consents.scope, 'ongoing'), eq(consents.encounterId, encounterId)) : eq(consents.scope, 'ongoing'),
      ),
    )
    .orderBy(sql`(${consents.version} = ${CONSENT_VERSIONS[type]}) desc`, desc(consents.recordedAt))
    .limit(1)
  const [row] = lock ? await query.for('share') : await query
  return row ?? null
}

/** granted (current wording) / outdated (earlier wording) / withdrawn / not_recorded. */
export async function consentState(db: DbOrTx, patientId: string, type: ConsentType, encounterId?: string): Promise<{ state: ConsentState; consent: ConsentRow | null }> {
  const c = await currentConsent(db, patientId, type, encounterId)
  if (c) return { state: c.version === CONSENT_VERSIONS[type] ? 'granted' : 'outdated', consent: c }
  // The latest decision, ignoring active consultation-only grants (they do not undo an ongoing withdrawal).
  const [last] = await db
    .select()
    .from(consents)
    .where(and(eq(consents.patientId, patientId), eq(consents.type, type), sql`not (${consents.scope} = 'encounter' and ${consents.status} = 'granted')`))
    .orderBy(desc(consents.recordedAt))
    .limit(1)
  return { state: last?.status === 'withdrawn' ? 'withdrawn' : 'not_recorded', consent: null }
}

const MESSAGES: Record<Exclude<ConsentState, 'granted'>, (title: string) => string> = {
  not_recorded: (t) => `The patient has not given consent to “${t}”. Record it on the patient record first.`,
  withdrawn: (t) => `The patient has withdrawn consent to “${t}”.`,
  outdated: (t) => `The patient agreed to an earlier wording of “${t}”. Read the current wording to the patient and record consent again.`,
}

/**
 * Enforces a consent at the API boundary. Throws 409 (consent_required,
 * consent_withdrawn or consent_outdated) and records the refusal in the audit
 * log; returns the grant that allowed the action.
 * `acceptOlderWording`: an earlier wording still covers this purpose.
 */
export async function requireConsent(
  db: DbOrTx,
  req: FastifyRequest,
  o: { patientId: string; type: ConsentType; purpose: string; encounterId?: string | undefined; acceptOlderWording?: boolean },
): Promise<ConsentRow> {
  const { state, consent } = await consentState(db, o.patientId, o.type, o.encounterId)
  if (consent && (state === 'granted' || o.acceptOlderWording)) return consent
  const code = state === 'withdrawn' ? 'consent_withdrawn' : state === 'outdated' ? 'consent_outdated' : 'consent_required'
  await audit(db, req, { action: 'consent.blocked', outcome: 'denied', entityType: 'patient', entityId: o.patientId, patientId: o.patientId, details: { type: o.type, purpose: o.purpose, state } })
  throw new HttpError(409, code, MESSAGES[state as Exclude<ConsentState, 'granted'>](CONSENT_LABELS[o.type].title))
}

export interface GrantInput {
  patientId: string
  type: ConsentType
  method: 'verbal' | 'written' | 'digital'
  notes?: string | null | undefined
  scope?: 'ongoing' | 'encounter'
  encounterId?: string | null
  recordedBy: string
}

/**
 * Records a grant with the current wording. An active grant with the current
 * wording is a conflict (already_granted); an active ongoing grant with an
 * earlier wording is superseded by this one (a renewal), in one transaction.
 */
export async function grantConsent(tx: DbOrTx, req: FastifyRequest, g: GrantInput): Promise<ConsentRow> {
  const scope = g.scope ?? 'ongoing'
  const existing = await currentConsent(tx, g.patientId, g.type, scope === 'encounter' ? (g.encounterId ?? undefined) : undefined)
  if (existing && existing.version === CONSENT_VERSIONS[g.type]) throw conflict('This consent is already recorded as granted', 'already_granted')
  const id = crypto.randomUUID()
  // A renewal ends the earlier-wording ongoing grant (the unique index allows one active ongoing grant).
  const candidate = existing && existing.scope === 'ongoing' && scope === 'ongoing' ? existing : null
  try {
    // It is a renewal only if the earlier grant is still active now (a concurrent withdrawal wins).
    let renews: ConsentRow | null = null
    if (candidate) {
      const sup = await tx.update(consents).set({ status: 'superseded', supersededBy: id }).where(and(eq(consents.id, candidate.id), eq(consents.status, 'granted'))).returning({ id: consents.id })
      if (sup.length) renews = candidate
    }
    const [row] = await tx
      .insert(consents)
      .values({ id, patientId: g.patientId, type: g.type, method: g.method, notes: g.notes ?? null, scope, encounterId: g.encounterId ?? null, version: CONSENT_VERSIONS[g.type], recordedBy: g.recordedBy })
      .returning()
    await audit(tx, req, {
      action: renews ? 'consent.renew' : 'consent.grant',
      entityType: 'consent',
      entityId: id,
      patientId: g.patientId,
      details: { type: g.type, method: g.method, scope, version: CONSENT_VERSIONS[g.type], ...(g.encounterId && { encounterId: g.encounterId }), ...(renews && { supersedes: renews.id, previousVersion: renews.version }) },
    })
    return row!
  } catch (e) {
    if (pgCode(e) === '23505') throw conflict('This consent is already recorded as granted', 'already_granted')
    throw e
  }
}

export interface WithdrawBy {
  userId: string
  via: 'staff' | 'patient_portal'
  reason: string | null
}

/**
 * Withdraws a purpose for a patient: every active grant of that type ends
 * (ongoing and consultation-only), and the consequences apply in the same
 * transaction so the withdrawal takes effect at once:
 * - portal_access: the portal account is switched off, its sessions end and
 *   unused activation codes are revoked;
 * - device_monitoring: open device assignments end.
 * Other purposes are enforced where they are used (requireConsent), including
 * research datasets that already contain the patient.
 */
export async function withdrawConsentType(tx: DbOrTx, req: FastifyRequest, patientId: string, type: ConsentType, by: WithdrawBy): Promise<{ withdrawn: string[]; effects: string[] }> {
  const rows = await tx
    .update(consents)
    .set({ status: 'withdrawn', withdrawnAt: sql`now()`, withdrawnBy: by.userId, withdrawReason: by.reason, withdrawnVia: by.via })
    .where(and(eq(consents.patientId, patientId), eq(consents.type, type), eq(consents.status, 'granted')))
    .returning({ id: consents.id })
  if (!rows.length) throw new HttpError(409, 'not_granted', 'This consent is no longer active')
  const effects: string[] = []
  if (type === 'portal_access') {
    const account = await tx.query.users.findFirst({ where: eq(users.patientId, patientId) })
    if (account?.isActive) {
      await tx.update(users).set({ isActive: false, updatedAt: sql`now()` }).where(eq(users.id, account.id))
      effects.push('portal_account_switched_off')
    }
    if (account) await revokeUserSessions(tx, account.id)
    const revoked = await tx
      .update(patientActivationCodes)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(patientActivationCodes.patientId, patientId), isNull(patientActivationCodes.usedAt), isNull(patientActivationCodes.revokedAt)))
      .returning({ id: patientActivationCodes.id })
    if (revoked.length) effects.push('activation_codes_revoked')
  }
  if (type === 'ai_recording') {
    // A recording in progress ends in the same step as the withdrawal, whether or not the browser notices: the record says so at once. Only the
    // recording ends. What was already captured (audio, transcript lines, points) is NOT deleted or hidden by this: that is a clinic decision.
    const live = await tx
      .update(transcripts)
      .set({ status: 'final', endedAt: sql`now()`, endReason: 'consent_withdrawn' })
      .where(and(eq(transcripts.status, 'live'), sql`${transcripts.encounterId} in (select id from ${encounters} where ${encounters.patientId} = ${patientId})`))
      .returning({ id: transcripts.id, encounterId: transcripts.encounterId })
    for (const t of live) await audit(tx, req, { action: 'ai.live_end', entityType: 'transcript', entityId: t.id, patientId, details: { encounterId: t.encounterId, reason: 'consent_withdrawn', via: 'consent_withdrawal' } })
    if (live.length) effects.push(`live_recordings_ended:${live.length}`)
  }
  if (type === 'device_monitoring') {
    const ended = await tx
      .update(deviceAssignments)
      .set({ endedAt: sql`now()`, endedBy: by.userId, endReason: 'Consent to device readings withdrawn' })
      .where(and(eq(deviceAssignments.patientId, patientId), isNull(deviceAssignments.endedAt)))
      .returning({ id: deviceAssignments.id })
    if (ended.length) effects.push(`device_assignments_ended:${ended.length}`)
  }
  await audit(tx, req, {
    action: 'consent.withdraw',
    entityType: 'consent',
    entityId: rows[0]!.id,
    patientId,
    // The reason text stays on the consent record; the audit only notes that one was given.
    details: { type, via: by.via, withdrawn: rows.map((r) => r.id), reasonGiven: !!by.reason, effects },
  })
  return { withdrawn: rows.map((r) => r.id), effects }
}
