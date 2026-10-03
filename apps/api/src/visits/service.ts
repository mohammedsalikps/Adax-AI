import { flagVital, type Observation, VITALS, type Visit, type VitalKind } from '@adaxai/contracts'
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { SessionUser } from '../auth/sessions.ts'
import type { DbOrTx } from '../db/client.ts'
import { allergies, appointments, dailyTokenCounters, departments, facilities, observations, patients, users, visits } from '../db/schema.ts'
import { deniedNotFound } from '../http/errors.ts'
import { ageOn, fullName } from '../patients/service.ts'

type ObservationRow = typeof observations.$inferSelect
export type VisitRow = typeof visits.$inferSelect

/** A visit of the caller's facility; lookups of other facilities' visits are refused as not found, and audited. */
export async function getVisitOr404(db: DbOrTx, me: SessionUser, id: string): Promise<VisitRow> {
  const v = await db.query.visits.findFirst({ where: and(eq(visits.id, id), eq(visits.facilityId, me.facilityId)) })
  if (!v) {
    const elsewhere = await db.query.visits.findFirst({ columns: { id: true }, where: eq(visits.id, id) })
    throw deniedNotFound('Visit', { entityType: 'visit', entityId: id, reason: elsewhere ? 'other_facility' : 'not_found' })
  }
  return v
}

export function toObservation(o: ObservationRow, ageYears: number | null, recordedByName: string | null, deviceLabel: string | null = null): Observation {
  return {
    id: o.id,
    kind: o.kind,
    value: Number(o.value),
    unit: o.unit,
    flag: o.enteredInError ? null : flagVital(o.kind, Number(o.value), ageYears),
    measuredAt: o.measuredAt.toISOString(),
    source: o.source,
    validationStatus: o.validationStatus as Observation['validationStatus'],
    deviceLabel,
    recordedByName,
    visitId: o.visitId,
    enteredInError: o.enteredInError,
  }
}

/** Latest valid value per vital kind for each visit. */
async function latestVitalsByVisit(db: DbOrTx, visitIds: string[], ages: Map<string, number>) {
  const out = new Map<string, Observation[]>()
  if (!visitIds.length) return out
  const recorder = alias(users, 'recorder')
  const rows = await db
    .selectDistinctOn([observations.visitId, observations.kind], { o: observations, by: recorder.fullName })
    .from(observations)
    .leftJoin(recorder, eq(recorder.id, observations.recordedBy))
    .where(and(inArray(observations.visitId, visitIds), eq(observations.enteredInError, false)))
    .orderBy(observations.visitId, observations.kind, sql`${observations.measuredAt} desc`)
  for (const { o, by } of rows) {
    const list = out.get(o.visitId!) ?? []
    list.push(toObservation(o, ages.get(o.visitId!) ?? null, by))
    out.set(o.visitId!, list)
  }
  return out
}

export interface NewVisit {
  patientId: string
  departmentId: string
  assignedDoctorId?: string | null
  priority?: 'normal' | 'urgent'
  chiefComplaint?: string | null
}

/**
 * Creates today's visit with the next token. The one place that does this
 * (walk-in check-in and appointment check-in both call it), so tokens are
 * allocated the same way: an atomic per-day counter in the same transaction as
 * the insert. The caller sets the lifecycle context first and writes the audit
 * event last (the audit chain lock is held from the audit insert to commit).
 */
export async function createVisit(tx: DbOrTx, me: SessionUser, v: NewVisit, today: string): Promise<VisitRow> {
  const [counter] = await tx
    .insert(dailyTokenCounters)
    .values({ facilityId: me.facilityId, visitDate: today, lastToken: 1 })
    .onConflictDoUpdate({ target: [dailyTokenCounters.facilityId, dailyTokenCounters.visitDate], set: { lastToken: sql`${dailyTokenCounters.lastToken} + 1` } })
    .returning({ token: dailyTokenCounters.lastToken })
  const [row] = await tx
    .insert(visits)
    .values({
      facilityId: me.facilityId,
      patientId: v.patientId,
      departmentId: v.departmentId,
      assignedDoctorId: v.assignedDoctorId ?? null,
      visitDate: today,
      tokenNumber: counter!.token,
      priority: v.priority ?? 'normal',
      chiefComplaint: v.chiefComplaint ?? null,
      createdBy: me.id,
    })
    .returning()
  return row!
}

/** Visits with patient summary, allergies and latest vitals, ordered for a queue. */
export async function loadVisits(db: DbOrTx, where: SQL, today: string, encounterIds: Map<string, string> = new Map()): Promise<Visit[]> {
  const doctor = alias(users, 'doctor')
  const rows = await db
    .select({
      v: visits,
      p: patients,
      deptName: departments.name,
      doctorName: doctor.fullName,
      apptId: appointments.id,
      apptAt: appointments.scheduledAt,
      apptLocalTime: sql<string | null>`to_char(${appointments.scheduledAt} at time zone ${facilities.timezone}, 'HH24:MI')`,
    })
    .from(visits)
    .innerJoin(patients, eq(patients.id, visits.patientId))
    .innerJoin(departments, eq(departments.id, visits.departmentId))
    .innerJoin(facilities, eq(facilities.id, visits.facilityId))
    .leftJoin(doctor, eq(doctor.id, visits.assignedDoctorId))
    .leftJoin(appointments, eq(appointments.visitId, visits.id))
    .where(where)
    // Urgent first, then by token.
    .orderBy(sql`case when ${visits.priority} = 'urgent' then 0 else 1 end`, asc(visits.visitDate), asc(visits.tokenNumber))
  const ages = new Map(rows.map(({ v, p }) => [v.id, ageOn(p.dateOfBirth, v.visitDate ?? today)]))
  const vitals = await latestVitalsByVisit(
    db,
    rows.map((r) => r.v.id),
    ages,
  )
  const patientIds = [...new Set(rows.map((r) => r.p.id))]
  const allergyRows = patientIds.length
    ? await db
        .select({ patientId: allergies.patientId, substance: allergies.substance })
        .from(allergies)
        .where(and(inArray(allergies.patientId, patientIds), eq(allergies.status, 'active')))
    : []
  return rows.map(({ v, p, deptName, doctorName, apptId, apptAt, apptLocalTime }) => {
    const latest = vitals.get(v.id) ?? []
    return {
      id: v.id,
      visitDate: v.visitDate,
      tokenNumber: v.tokenNumber,
      status: v.status,
      priority: v.priority,
      chiefComplaint: v.chiefComplaint,
      departmentId: v.departmentId,
      departmentName: deptName,
      assignedDoctorId: v.assignedDoctorId,
      assignedDoctorName: doctorName,
      checkedInAt: v.checkedInAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
      encounterId: encounterIds.get(v.id) ?? null,
      appointment: apptId && apptAt && apptLocalTime ? { id: apptId, scheduledAt: apptAt.toISOString(), localTime: apptLocalTime } : null,
      patient: {
        id: p.id,
        mrn: p.mrn,
        fullName: fullName(p),
        sex: p.sex,
        dateOfBirth: p.dateOfBirth,
        noKnownAllergies: p.noKnownAllergies,
        activeAllergies: allergyRows.filter((a) => a.patientId === p.id).map((a) => a.substance),
      },
      latestVitals: latest,
      abnormalVitalCount: latest.filter((o) => o.flag && o.flag !== 'normal').length,
    }
  })
}

export const unitFor = (kind: VitalKind) => VITALS[kind].unit
