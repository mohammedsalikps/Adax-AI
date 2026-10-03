import { type Appointment, type AppointmentStatus, notificationIsCurrent } from '@adaxai/contracts'
import { and, desc, eq, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { can as canDo } from '../auth/permissions.ts'
import type { SessionUser } from '../auth/sessions.ts'
import { type DbOrTx, pgCode, pgConstraint } from '../db/client.ts'
import { appointments, departments, facilities, patients, users, visits } from '../db/schema.ts'
import { badRequest, conflict, deniedNotFound } from '../http/errors.ts'
import { fullName, getPatientOr404 } from '../patients/service.ts'

export type AppointmentRow = typeof appointments.$inferSelect

const doctor = alias(users, 'doctor')
const creator = alias(users, 'creator')

/** An appointment of the caller's facility; another facility's id is "not found", and the lookup is audited. */
export async function getAppointmentOr404(db: DbOrTx, me: SessionUser, id: string): Promise<AppointmentRow> {
  const a = await db.query.appointments.findFirst({ where: and(eq(appointments.id, id), eq(appointments.facilityId, me.facilityId)) })
  if (!a) {
    const elsewhere = await db.query.appointments.findFirst({ columns: { id: true }, where: eq(appointments.id, id) })
    throw deniedNotFound('Appointment', { entityType: 'appointment', entityId: id, reason: elsewhere ? 'other_facility' : 'not_found' })
  }
  return a
}

/**
 * Appointments as the signed-in role may see them, with times on the
 * facility's clock. Administrators see the schedule without the patient's
 * identity or any free text (reason, status reason); the server also says
 * which actions the user may take, so the UI never offers one it would refuse.
 */
export async function loadAppointments(db: DbOrTx, me: SessionUser, where: SQL, o: { order?: 'asc' | 'desc'; limit?: number; now?: Date } = {}): Promise<Appointment[]> {
  const now = o.now ?? new Date()
  const rows = await db
    .select({
      a: appointments,
      p: patients,
      deptName: departments.name,
      doctorName: doctor.fullName,
      creatorName: creator.fullName,
      localDate: sql<string>`to_char(${appointments.scheduledAt} at time zone ${facilities.timezone}, 'YYYY-MM-DD')`,
      localTime: sql<string>`to_char(${appointments.scheduledAt} at time zone ${facilities.timezone}, 'HH24:MI')`,
      endsLocalTime: sql<string>`to_char(appointment_ends_at(${appointments.scheduledAt}, ${appointments.durationMinutes}) at time zone ${facilities.timezone}, 'HH24:MI')`,
      today: sql<string>`(now() at time zone ${facilities.timezone})::date::text`,
      visitStatus: visits.status,
      visitToken: visits.tokenNumber,
      visitDate: visits.visitDate,
      messageKind: sql<string | null>`(select n.kind from notifications n where n.appointment_id = ${appointments.id} order by n.created_at desc, n.id desc limit 1)`,
      messageStatus: sql<'queued' | 'delivered' | 'undeliverable' | 'failed' | null>`(select n.status from notifications n where n.appointment_id = ${appointments.id} order by n.created_at desc, n.id desc limit 1)`,
      messageCode: sql<string | null>`(select n.failure_code from notifications n where n.appointment_id = ${appointments.id} order by n.created_at desc, n.id desc limit 1)`,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(departments, eq(departments.id, appointments.departmentId))
    .innerJoin(facilities, eq(facilities.id, appointments.facilityId))
    .leftJoin(doctor, eq(doctor.id, appointments.doctorId))
    .leftJoin(creator, eq(creator.id, appointments.createdBy))
    .leftJoin(visits, eq(visits.id, appointments.visitId))
    .where(where)
    .orderBy(o.order === 'desc' ? desc(appointments.scheduledAt) : sql`${appointments.scheduledAt} asc`, appointments.id)
    .limit(o.limit ?? 300)
  const manage = canDo(me.role, 'appointments:manage')
  const redact = me.role === 'admin'
  return rows.map(({ a, p, deptName, doctorName, creatorName, localDate, localTime, endsLocalTime, today, visitStatus, visitToken, visitDate, messageKind, messageStatus, messageCode }) => {
    const booked = a.status === 'booked'
    const overdue = booked && a.scheduledAt.getTime() <= now.getTime()
    return {
      id: a.id,
      status: a.status,
      version: a.version,
      scheduledAt: a.scheduledAt.toISOString(),
      localDate,
      localTime,
      endsLocalTime,
      durationMinutes: a.durationMinutes,
      patient: redact ? null : { id: p.id, mrn: p.mrn, fullName: fullName(p) },
      departmentId: a.departmentId,
      departmentName: deptName,
      doctorId: a.doctorId,
      doctorName,
      reason: redact ? null : a.reason,
      statusReason: redact ? null : a.statusReason,
      visit: a.visitId && visitStatus && visitToken !== null && visitDate ? { id: a.visitId, status: visitStatus, tokenNumber: visitToken, visitDate } : null,
      overdue,
      actions: { checkIn: manage && booked && localDate === today, reschedule: manage && booked, cancel: manage && booked, noShow: manage && booked && overdue },
      // Only a message that still holds counts: an appointment closed by its visit has no cancellation message, and its old booking message says nothing about the patient now.
      patientMessage: messageStatus && messageKind && notificationIsCurrent(messageKind, a.status) ? { status: messageStatus, code: messageCode } : null,
      createdByName: creatorName,
      createdAt: a.createdAt.toISOString(),
    }
  })
}

export async function loadAppointment(db: DbOrTx, me: SessionUser, id: string): Promise<Appointment> {
  const [a] = await loadAppointments(db, me, eq(appointments.id, id), { limit: 1 })
  if (!a) throw deniedNotFound('Appointment', { entityType: 'appointment', entityId: id, reason: 'not_found' })
  return a
}

export interface BookingTarget {
  patientId: string
  departmentId: string
  doctorId?: string | null | undefined
}

/**
 * Who and where a booking is for: a patient of this facility, an active
 * department of it, and (optionally) an active doctor of it. A doctor who is
 * assigned to a department can only be booked into that department. Problems
 * come back as field issues for the form.
 */
export async function assertCanBook(db: DbOrTx, me: SessionUser, t: BookingTarget): Promise<void> {
  await getPatientOr404(db, me.facilityId, t.patientId)
  const issues: { path: string; message: string }[] = []
  const dept = await db.query.departments.findFirst({ where: and(eq(departments.id, t.departmentId), eq(departments.facilityId, me.facilityId), eq(departments.isActive, true)) })
  if (!dept) issues.push({ path: 'departmentId', message: 'Choose an active department' })
  if (t.doctorId) {
    const d = await db.query.users.findFirst({ where: and(eq(users.id, t.doctorId), eq(users.role, 'doctor'), eq(users.isActive, true), eq(users.facilityId, me.facilityId)) })
    if (!d) issues.push({ path: 'doctorId', message: 'Choose an active doctor' })
    else if (dept && d.departmentId && d.departmentId !== dept.id) issues.push({ path: 'doctorId', message: 'This doctor works in another department. Choose a doctor of the department, or the department of the doctor.' })
  }
  if (issues.length) throw badRequest('Some fields are invalid', issues)
}

/**
 * Turns the database's refusal of an overlap into a clear conflict. The
 * message names no other patient: it only says which kind of slot is taken.
 */
export function slotConflict(e: unknown): never {
  if (pgCode(e) === '23P01') {
    const c = pgConstraint(e)
    if (c === 'appointments_doctor_no_overlap') throw conflict('That clinician already has an appointment at this time. Choose another time or clinician.', 'slot_taken')
    if (c === 'appointments_patient_no_overlap') throw conflict('The patient already has an appointment that overlaps this time.', 'patient_double_booked')
  }
  throw e
}

/**
 * Serialises changes that compete for the same slots. Booking and rescheduling
 * take these locks first, in one fixed order, so two of them can never wait for
 * each other (a deadlock) and a clash is always answered by the exclusion
 * constraint, never by a database error. Held until the transaction ends.
 */
export async function lockSchedule(tx: DbOrTx, who: { doctorIds: (string | null | undefined)[]; patientId: string }): Promise<void> {
  const keys = [...new Set([...who.doctorIds.filter((d): d is string => !!d).map((d) => `doctor:${d}`), `patient:${who.patientId}`])].sort()
  for (const k of keys) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'appointment-slot:' + k}, 0))`)
}

export const STALE = 'The appointment was changed by someone else. Refresh and try again.'

export const CLOSED_MESSAGE: Record<AppointmentStatus, string> = {
  booked: '',
  checked_in: 'The patient is checked in. Close the visit in the queue instead: the appointment follows it.',
  completed: 'This appointment is completed and cannot be changed.',
  cancelled: 'This appointment was cancelled and cannot be changed.',
  rescheduled: 'This appointment was moved to a new time and cannot be changed. Open the new one.',
  no_show: 'This appointment was marked as did not attend and cannot be changed.',
}

/** What a manual change of an appointment that is not booked is told. */
export const notBookedCode = (s: AppointmentStatus) => (s === 'checked_in' ? 'appointment_checked_in' : 'appointment_closed')

