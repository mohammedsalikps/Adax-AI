import { type Allergy, type Consent, CONSENT_LABELS, CONSENT_VERSIONS, type ConsentSummary, type ConsentType, type PatientDetail, type PatientSummary } from '@adaxai/contracts'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { DbOrTx } from '../db/client.ts'
import { allergies, consents, facilities, patientActivationCodes, patients, users, visits } from '../db/schema.ts'
import { deniedNotFound, notFound } from '../http/errors.ts'

export type PatientRow = typeof patients.$inferSelect

export const fullName = (p: Pick<PatientRow, 'givenName' | 'familyName'>) => [p.givenName, p.familyName].filter(Boolean).join(' ')

/** Whole years between a YYYY-MM-DD birth date and a YYYY-MM-DD day. */
export function ageOn(dob: string, day: string): number {
  const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number]
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age--
  return age
}

/** Today's date (YYYY-MM-DD) in the facility's timezone. */
export async function facilityToday(db: DbOrTx, facilityId: string): Promise<string> {
  const [row] = await db
    .select({ today: sql<string>`(now() at time zone ${facilities.timezone})::date::text` })
    .from(facilities)
    .where(eq(facilities.id, facilityId))
  if (!row) throw notFound('Facility')
  return row.today
}

export function toSummary(p: PatientRow, lastVisitDate: string | null = null): PatientSummary {
  return {
    id: p.id,
    mrn: p.mrn,
    fullName: fullName(p),
    sex: p.sex,
    dateOfBirth: p.dateOfBirth,
    dateOfBirthEstimated: p.dateOfBirthEstimated,
    phone: p.phone,
    lastVisitDate,
    dataOrigin: p.dataOrigin as PatientSummary['dataOrigin'],
  }
}

/** Loads a patient of the caller's facility or throws 404 (never reveals other facilities' records). */
export async function getPatientOr404(db: DbOrTx, facilityId: string, patientId: string): Promise<PatientRow> {
  const p = await db.query.patients.findFirst({ where: and(eq(patients.id, patientId), eq(patients.facilityId, facilityId)) })
  if (!p) {
    // Same answer whether the patient is elsewhere or does not exist; the audit log tells them apart.
    const elsewhere = await db.query.patients.findFirst({ columns: { id: true }, where: eq(patients.id, patientId) })
    throw deniedNotFound('Patient', { entityType: 'patient', entityId: patientId, reason: elsewhere ? 'other_facility' : 'not_found' })
  }
  return p
}

export async function listAllergies(db: DbOrTx, patientId: string): Promise<Allergy[]> {
  const rows = await db
    .select({ a: allergies, by: users.fullName })
    .from(allergies)
    .leftJoin(users, eq(users.id, allergies.recordedBy))
    .where(eq(allergies.patientId, patientId))
    .orderBy(desc(allergies.recordedAt))
  return rows.map(({ a, by }) => ({
    id: a.id,
    substance: a.substance,
    reaction: a.reaction,
    severity: a.severity,
    status: a.status as Allergy['status'],
    recordedAt: a.recordedAt.toISOString(),
    recordedByName: by,
  }))
}

export async function listConsents(db: DbOrTx, patientId: string): Promise<Consent[]> {
  const withdrawer = alias(users, 'withdrawer')
  const rows = await db
    .select({ c: consents, by: users.fullName, wBy: withdrawer.fullName })
    .from(consents)
    .leftJoin(users, eq(users.id, consents.recordedBy))
    .leftJoin(withdrawer, eq(withdrawer.id, consents.withdrawnBy))
    .where(eq(consents.patientId, patientId))
    .orderBy(desc(consents.recordedAt))
  return rows.map(({ c, by, wBy }) => ({
    id: c.id,
    type: c.type,
    status: c.status as Consent['status'],
    method: c.method,
    scope: c.scope as Consent['scope'],
    encounterId: c.encounterId,
    notes: c.notes,
    recordedAt: c.recordedAt.toISOString(),
    recordedByName: by,
    withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
    withdrawnByName: wBy,
    withdrawReason: c.withdrawReason,
    withdrawnVia: c.withdrawnVia,
    supersededBy: c.supersededBy,
    version: c.version,
    currentWording: c.version === CONSENT_VERSIONS[c.type],
  }))
}

/** State of every consent purpose for a patient (ongoing grants; consultation-only grants are shown in the history). */
export function consentSummary(list: Consent[]): ConsentSummary[] {
  return (Object.keys(CONSENT_LABELS) as ConsentType[]).map((type) => {
    const active = list.filter((c) => c.type === type && c.status === 'granted' && c.scope === 'ongoing').sort((a, b) => Number(b.currentWording) - Number(a.currentWording) || b.recordedAt.localeCompare(a.recordedAt))[0]
    if (active) return { type, state: active.currentWording ? 'granted' : 'outdated', consentId: active.id }
    const last = list.find((c) => c.type === type && !(c.scope === 'encounter' && c.status === 'granted'))
    return { type, state: last?.status === 'withdrawn' ? 'withdrawn' : 'not_recorded', consentId: null }
  })
}

/** The grant that applies now (current wording first, then the most recent). */
export { currentConsent as activeConsent } from '../consents/service.ts'

export async function loadPatientDetail(db: DbOrTx, p: PatientRow): Promise<PatientDetail> {
  const portalUser = alias(users, 'portal_user')
  const consentList = await listConsents(db, p.id)
  const [[account], [pending], [last]] = await Promise.all([
    db.select({ active: portalUser.isActive }).from(portalUser).where(eq(portalUser.patientId, p.id)).limit(1),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(patientActivationCodes)
      .where(and(eq(patientActivationCodes.patientId, p.id), isNull(patientActivationCodes.usedAt), isNull(patientActivationCodes.revokedAt), sql`${patientActivationCodes.expiresAt} > now()`)),
    db.select({ d: sql<string | null>`max(${visits.visitDate})::text` }).from(visits).where(eq(visits.patientId, p.id)),
  ])
  return {
    ...toSummary(p, last?.d ?? null),
    givenName: p.givenName,
    familyName: p.familyName,
    email: p.email,
    addressLine: p.addressLine,
    city: p.city,
    state: p.state,
    postalCode: p.postalCode,
    abhaNumber: p.abhaNumber,
    bloodGroup: p.bloodGroup as PatientDetail['bloodGroup'],
    preferredLanguage: p.preferredLanguage,
    emergencyContactName: p.emergencyContactName,
    emergencyContactPhone: p.emergencyContactPhone,
    noKnownAllergies: p.noKnownAllergies,
    allergies: await listAllergies(db, p.id),
    consents: consentList,
    consentStates: consentSummary(consentList),
    portalAccount: { state: !account ? 'none' : account.active ? 'active' : 'deactivated', active: !!account?.active, activationPending: (pending?.n ?? 0) > 0 },
    createdAt: p.createdAt.toISOString(),
  }
}
