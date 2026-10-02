import type { Allergy, Consent, PatientDetail, PatientSummary } from '@adaxai/contracts'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { DbOrTx } from '../db/client.ts'
import { allergies, consents, facilities, patientActivationCodes, patients, users, visits } from '../db/schema.ts'
import { notFound } from '../http/errors.ts'

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
  }
}

/** Loads a patient of the caller's facility or throws 404 (never reveals other facilities' records). */
export async function getPatientOr404(db: DbOrTx, facilityId: string, patientId: string): Promise<PatientRow> {
  const p = await db.query.patients.findFirst({ where: and(eq(patients.id, patientId), eq(patients.facilityId, facilityId)) })
  if (!p) throw notFound('Patient')
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
  const rows = await db
    .select({ c: consents, by: users.fullName })
    .from(consents)
    .leftJoin(users, eq(users.id, consents.recordedBy))
    .where(eq(consents.patientId, patientId))
    .orderBy(desc(consents.recordedAt))
  return rows.map(({ c, by }) => ({
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
    version: c.version,
  }))
}

/** Active (granted, not withdrawn) ongoing consent of a type, if any. */
export async function activeConsent(db: DbOrTx, patientId: string, type: Consent['type'], encounterId?: string) {
  return db.query.consents.findFirst({
    where: and(
      eq(consents.patientId, patientId),
      eq(consents.type, type),
      eq(consents.status, 'granted'),
      isNull(consents.withdrawnAt),
      encounterId ? sql`(${consents.scope} = 'ongoing' or ${consents.encounterId} = ${encounterId})` : eq(consents.scope, 'ongoing'),
    ),
  })
}

export async function loadPatientDetail(db: DbOrTx, p: PatientRow): Promise<PatientDetail> {
  const portalUser = alias(users, 'portal_user')
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
    consents: await listConsents(db, p.id),
    portalAccount: { active: !!account?.active, activationPending: (pending?.n ?? 0) > 0 },
    createdAt: p.createdAt.toISOString(),
  }
}
