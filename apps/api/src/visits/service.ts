import { flagVital, type Observation, VITALS, type Visit, type VitalKind } from '@adaxai/contracts'
import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { DbOrTx } from '../db/client.ts'
import { allergies, departments, observations, patients, users, visits } from '../db/schema.ts'
import { ageOn, fullName } from '../patients/service.ts'

type ObservationRow = typeof observations.$inferSelect

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

/** Visits with patient summary, allergies and latest vitals, ordered for a queue. */
export async function loadVisits(db: DbOrTx, where: SQL, today: string, encounterIds: Map<string, string> = new Map()): Promise<Visit[]> {
  const doctor = alias(users, 'doctor')
  const rows = await db
    .select({ v: visits, p: patients, deptName: departments.name, doctorName: doctor.fullName })
    .from(visits)
    .innerJoin(patients, eq(patients.id, visits.patientId))
    .innerJoin(departments, eq(departments.id, visits.departmentId))
    .leftJoin(doctor, eq(doctor.id, visits.assignedDoctorId))
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
  return rows.map(({ v, p, deptName, doctorName }) => {
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
