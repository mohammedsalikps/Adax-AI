import crypto from 'node:crypto'
import {
  APPOINTMENT_POLICY,
  type AppointmentDetail,
  type AppointmentList,
  type AppointmentOptions,
  AppointmentQuery,
  AppointmentStatus,
  CancelAppointmentRequest,
  CheckInAppointmentRequest,
  type CheckInOutcome,
  type CheckInResult,
  CreateAppointmentRequest,
  type NotificationPayload,
  NoShowAppointmentRequest,
  OPEN_VISIT_STATUSES,
  type PatientAppointments,
  RescheduleAppointmentRequest,
  type RetryNotificationsResult,
} from '@adaxai/contracts'
import { and, asc, count, desc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import { type Db, type DbOrTx, pgCode, pgConstraint } from '../db/client.ts'
import { setLifecycleContext } from '../db/lifecycle.ts'
import { appointments, appointmentStatusEvents, departments, facilities, notifications, users, visits } from '../db/schema.ts'
import { badRequest, conflict, HttpError } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { getPatientOr404 } from '../patients/service.ts'
import { createVisit } from '../visits/service.ts'
import { dispatchAll, enqueueNotification, inAppChannel, type NotificationChannel, toStaffNotification, undeliveredFor } from './notifications.ts'
import { addDays, facilityClock, localInstant, resolveSlot } from './schedule.ts'
import { type AppointmentRow, assertCanBook, CLOSED_MESSAGE, getAppointmentOr404, loadAppointment, loadAppointments, lockSchedule, notBookedCode, slotConflict, STALE } from './service.ts'

const IdParams = z.object({ id: z.uuid() })
/** "Past" lists the last this-many days (older appointments stay in the patient's own list). */
const PAST_DAYS = 90

export interface AppointmentDeps {
  db: Db
  /** How messages are delivered. Defaults to the patient portal; tests supply their own. */
  channel?: NotificationChannel | undefined
}

export function registerAppointmentRoutes(app: FastifyInstance, deps: AppointmentDeps) {
  const { db } = deps
  const channel = deps.channel ?? inAppChannel
  const read = { config: { permission: 'appointments:read' as const } }
  const manage = { config: { permission: 'appointments:manage' as const } }

  /** A refusal of a status change is audited, then answered. */
  async function refuse(req: FastifyRequest, action: string, a: Pick<AppointmentRow, 'id' | 'patientId' | 'status'>, err: HttpError): Promise<never> {
    await audit(db, req, { action: `appointment.${action}`, outcome: 'failure', entityType: 'appointment', entityId: a.id, patientId: a.patientId, details: { code: err.code, status: a.status } })
    throw err
  }

  const closedError = (a: AppointmentRow) => new HttpError(409, notBookedCode(a.status), CLOSED_MESSAGE[a.status])
  const staleError = () => new HttpError(409, 'stale_appointment', STALE)

  async function payloadFor(q: DbOrTx, a: Pick<AppointmentRow, 'scheduledAt' | 'durationMinutes' | 'departmentId' | 'doctorId'>, previousAt?: Date): Promise<NotificationPayload> {
    const [row] = await q.select({ timezone: facilities.timezone, department: departments.name }).from(departments).innerJoin(facilities, eq(facilities.id, departments.facilityId)).where(eq(departments.id, a.departmentId))
    const doctor = a.doctorId ? (await q.select({ name: users.fullName }).from(users).where(eq(users.id, a.doctorId)))[0]?.name ?? null : null
    return { scheduledAt: a.scheduledAt.toISOString(), timezone: row!.timezone, durationMinutes: a.durationMinutes, departmentName: row!.department, doctorName: doctor, previousScheduledAt: previousAt?.toISOString() ?? null }
  }

  /**
   * Hands queued messages to the channel after the change has committed. A
   * delivery problem is recorded on the message (and audited, with counts only)
   * and never fails the change that caused it.
   */
  async function deliver(req: FastifyRequest, a: Pick<AppointmentRow, 'id' | 'patientId'>, ids: string[]) {
    if (!ids.length) return
    try {
      const sum = await dispatchAll(db, channel, ids, null, (e) => req.log.error({ code: pgCode(e) }, 'notification attempt failed'))
      await audit(db, req, { action: 'notification.dispatch', outcome: sum.failed ? 'failure' : 'success', entityType: 'appointment', entityId: a.id, patientId: a.patientId, details: { ...sum, channel: channel.name } })
    } catch (e) {
      req.log.error({ code: pgCode(e) }, 'notification dispatch failed')
    }
  }

  const findByKey = (facilityId: string, key: string) => db.query.appointments.findFirst({ where: and(eq(appointments.facilityId, facilityId), eq(appointments.idempotencyKey, key)) })

  /** A retried request is the same booking only if it asks for the same thing. */
  const sameBooking = (a: AppointmentRow, w: { patientId: string; departmentId: string; doctorId: string | null; instant: Date; durationMinutes: number }) =>
    a.patientId === w.patientId && a.departmentId === w.departmentId && a.doctorId === w.doctorId && a.scheduledAt.getTime() === w.instant.getTime() && a.durationMinutes === w.durationMinutes

  // ---- Schedule options for the booking form ----
  app.get('/api/appointments/options', manage, async (req): Promise<AppointmentOptions> => {
    const me = currentUser(req)
    const clock = await facilityClock(db, me.facilityId)
    return { timezone: clock.timezone, today: clock.today, maxDate: addDays(clock.today, APPOINTMENT_POLICY.maxDaysAhead), durations: [...APPOINTMENT_POLICY.durations], defaultDuration: APPOINTMENT_POLICY.defaultDuration, slotMinutes: APPOINTMENT_POLICY.slotMinutes }
  })

  // ---- The schedule ----
  app.get('/api/appointments', read, async (req): Promise<AppointmentList> => {
    const me = currentUser(req)
    const q = parse(AppointmentQuery, req.query)
    const clock = await facilityClock(db, me.facilityId)
    const range =
      q.scope === 'today'
        ? { from: clock.today, to: clock.today }
        : q.scope === 'upcoming'
          ? { from: addDays(clock.today, 1), to: null }
          : q.scope === 'past'
            ? { from: addDays(clock.today, -PAST_DAYS), to: addDays(clock.today, -1) }
            : { from: q.date!, to: q.date! }
    const statuses = (q.status ?? '')
      .split(',')
      .map((s) => AppointmentStatus.safeParse(s.trim()))
      .flatMap((r) => (r.success ? [r.data] : []))
    // A moved appointment is replaced by its new one; it is listed only when asked for.
    const base: SQL[] = [eq(appointments.facilityId, me.facilityId)]
    if (!statuses.includes('rescheduled')) base.push(ne(appointments.status, 'rescheduled'))
    // Local days to instants on the facility's clock.
    if (range.from) base.push(gte(appointments.scheduledAt, sql`(${range.from}::date)::timestamp at time zone ${clock.timezone}`))
    if (range.to) base.push(lt(appointments.scheduledAt, sql`((${range.to}::date + 1))::timestamp at time zone ${clock.timezone}`))
    if (q.doctorId) base.push(eq(appointments.doctorId, q.doctorId))
    if (q.mine === 'true' && me.role === 'doctor') {
      base.push((me.departmentId ? or(eq(appointments.doctorId, me.id), and(isNull(appointments.doctorId), eq(appointments.departmentId, me.departmentId))) : eq(appointments.doctorId, me.id))!)
    }
    const items = await loadAppointments(db, me, and(...base, statuses.length ? inArray(appointments.status, statuses) : undefined)!, { order: q.scope === 'past' ? 'desc' : 'asc', limit: q.limit + 1 })
    const counts: Record<string, number> = {}
    for (const r of await db.select({ status: appointments.status, n: count() }).from(appointments).where(and(...base)).groupBy(appointments.status)) counts[r.status] = r.n
    const shown = items.slice(0, q.limit)
    await audit(db, req, {
      action: 'appointment.list',
      details: { scope: q.scope, count: shown.length, ...(me.role !== 'admin' && { patientIds: [...new Set(shown.flatMap((i) => (i.patient ? [i.patient.id] : [])))] }) },
    })
    return { timezone: clock.timezone, today: clock.today, scope: q.scope, from: range.from, to: range.to, items: shown, counts, truncated: items.length > q.limit }
  })

  /** One patient's appointments, newest first (for the patient record). */
  app.get('/api/patients/:id/appointments', manage, async (req): Promise<PatientAppointments> => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    await getPatientOr404(db, me.facilityId, id)
    const clock = await facilityClock(db, me.facilityId)
    const items = await loadAppointments(db, me, and(eq(appointments.facilityId, me.facilityId), eq(appointments.patientId, id), ne(appointments.status, 'rescheduled'))!, { order: 'desc', limit: 50 })
    await audit(db, req, { action: 'appointment.patient_list', entityType: 'patient', entityId: id, patientId: id, details: { count: items.length } })
    return { timezone: clock.timezone, today: clock.today, items }
  })

  app.get('/api/appointments/:id', manage, async (req): Promise<AppointmentDetail> => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const a = await getAppointmentOr404(db, me, id)
    const actor = alias(users, 'actor')
    const [appointment, history, notes, refs] = await Promise.all([
      loadAppointment(db, me, id),
      db
        .select({ e: appointmentStatusEvents, by: actor.fullName })
        .from(appointmentStatusEvents)
        .leftJoin(actor, eq(actor.id, appointmentStatusEvents.actorUserId))
        .where(eq(appointmentStatusEvents.appointmentId, id))
        .orderBy(asc(appointmentStatusEvents.id)),
      db.select().from(notifications).where(eq(notifications.appointmentId, id)).orderBy(asc(notifications.createdAt)),
      loadAppointments(db, me, inArray(appointments.id, [a.rescheduledFrom, a.rescheduledTo].filter((x): x is string => !!x)), { limit: 2 }),
    ])
    const ref = (rid: string | null) => {
      const r = refs.find((x) => x.id === rid)
      return r ? { id: r.id, scheduledAt: r.scheduledAt, localDate: r.localDate, localTime: r.localTime, status: r.status } : null
    }
    await audit(db, req, { action: 'appointment.read', entityType: 'appointment', entityId: id, patientId: a.patientId })
    return {
      timezone: (await facilityClock(db, me.facilityId)).timezone,
      appointment,
      history: history.map(({ e, by }) => ({ from: e.fromStatus, to: e.toStatus, source: e.source, reason: e.reason, actorName: by, at: e.changedAt.toISOString() })),
      notifications: notes.map((n) => toStaffNotification(n, a.status)),
      previous: ref(a.rescheduledFrom),
      next: ref(a.rescheduledTo),
    }
  })

  // ---- Book ----
  app.post('/api/appointments', manage, async (req, reply) => {
    const me = currentUser(req)
    const body = parse(CreateAppointmentRequest, req.body)
    const doctorId = body.doctorId ?? null
    const clock = await facilityClock(db, me.facilityId)

    // A retry of a request that already succeeded returns that appointment; a different request with the same key is refused.
    const replay = async (): Promise<AppointmentRow | null> => {
      const prior = await findByKey(me.facilityId, body.idempotencyKey)
      if (!prior) return null
      const { instant } = await localInstant(db, clock.timezone, body.date, body.time)
      if (!sameBooking(prior, { patientId: body.patientId, departmentId: body.departmentId, doctorId, instant, durationMinutes: body.durationMinutes })) {
        throw conflict('This request id was already used for a different booking.', 'idempotency_key_reused')
      }
      return prior
    }
    const prior = await replay()
    if (prior) return reply.code(200).send(await loadAppointment(db, me, prior.id))

    await assertCanBook(db, me, { patientId: body.patientId, departmentId: body.departmentId, doctorId })
    const instant = await resolveSlot(db, clock, body.date, body.time)
    try {
      const created = await db.transaction(async (tx) => {
        await setLifecycleContext(tx, { actorId: me.id, source: 'booking' })
        await lockSchedule(tx, { doctorIds: [doctorId], patientId: body.patientId })
        const [row] = await tx
          .insert(appointments)
          .values({ facilityId: me.facilityId, patientId: body.patientId, departmentId: body.departmentId, doctorId, scheduledAt: instant, durationMinutes: body.durationMinutes, reason: body.reason ?? null, idempotencyKey: body.idempotencyKey, createdBy: me.id })
          .returning()
        const queued = await enqueueNotification(tx, { facilityId: me.facilityId, patientId: body.patientId, appointmentId: row!.id, kind: 'appointment.booked', payload: await payloadFor(tx, row!) })
        await audit(tx, req, { action: 'appointment.create', entityType: 'appointment', entityId: row!.id, patientId: body.patientId, details: { scheduledAt: instant.toISOString(), durationMinutes: body.durationMinutes, doctorAssigned: !!doctorId } })
        return { row: row!, queued }
      })
      await deliver(req, created.row, created.queued ? [created.queued] : [])
      return reply.code(201).send(await loadAppointment(db, me, created.row.id))
    } catch (e) {
      // Two identical requests at once: the second finds the first's appointment instead of failing.
      // (A same-key request for something else is refused by replay itself.)
      if (pgCode(e) === '23505' || pgCode(e) === '23P01') {
        const twin = await replay()
        if (twin) return reply.code(200).send(await loadAppointment(db, me, twin.id))
      }
      return slotConflict(e)
    }
  })

  // ---- Reschedule: book the new time, close this one as rescheduled ----
  app.post('/api/appointments/:id/reschedule', manage, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(RescheduleAppointmentRequest, req.body)
    const old = await getAppointmentOr404(db, me, id)
    const clock = await facilityClock(db, me.facilityId)
    const next = {
      patientId: old.patientId,
      departmentId: body.departmentId ?? old.departmentId,
      doctorId: body.doctorId === undefined ? old.doctorId : body.doctorId,
      durationMinutes: body.durationMinutes ?? old.durationMinutes,
    }

    // A retry returns the replacement it made; the same key for something else is refused.
    const replay = async (): Promise<AppointmentRow | null> => {
      const prior = await findByKey(me.facilityId, body.idempotencyKey)
      if (!prior) return null
      const { instant } = await localInstant(db, clock.timezone, body.date, body.time)
      if (prior.rescheduledFrom !== old.id || !sameBooking(prior, { ...next, instant })) throw conflict('This request id was already used for a different change.', 'idempotency_key_reused')
      return prior
    }
    const prior = await replay()
    if (prior) return reply.code(200).send(await loadAppointment(db, me, prior.id))

    if (old.status !== 'booked') await refuse(req, 'reschedule', old, closedError(old))
    if (old.version !== body.version) await refuse(req, 'reschedule', old, staleError())
    await assertCanBook(db, me, next)
    const instant = await resolveSlot(db, clock, body.date, body.time)
    if (sameBooking(old, { ...next, instant })) throw badRequest('Some fields are invalid', [{ path: 'time', message: 'This is the time the appointment already has. Choose a different time, clinician or department.' }])

    const newId = crypto.randomUUID()
    try {
      const made = await db.transaction(async (tx) => {
        await setLifecycleContext(tx, { actorId: me.id, source: 'reschedule', reason: body.reason })
        await lockSchedule(tx, { doctorIds: [old.doctorId, next.doctorId], patientId: old.patientId })
        // The old appointment is released first, so the new one may take an overlapping slot of the same doctor.
        const [closed] = await tx
          .update(appointments)
          .set({ status: 'rescheduled', statusReason: body.reason, rescheduledTo: newId, version: sql`${appointments.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(appointments.id, old.id), eq(appointments.version, body.version), eq(appointments.status, 'booked')))
          .returning({ id: appointments.id })
        if (!closed) throw staleError()
        const [row] = await tx
          .insert(appointments)
          .values({ id: newId, facilityId: me.facilityId, ...next, scheduledAt: instant, reason: old.reason, rescheduledFrom: old.id, idempotencyKey: body.idempotencyKey, createdBy: me.id })
          .returning()
        const queued = await enqueueNotification(tx, { facilityId: me.facilityId, patientId: old.patientId, appointmentId: newId, kind: 'appointment.rescheduled', payload: await payloadFor(tx, row!, old.scheduledAt) })
        await audit(tx, req, { action: 'appointment.reschedule', entityType: 'appointment', entityId: newId, patientId: old.patientId, details: { replaces: old.id, from: old.scheduledAt.toISOString(), to: instant.toISOString() } })
        return { row: row!, queued }
      })
      await deliver(req, made.row, made.queued ? [made.queued] : [])
      return reply.code(201).send(await loadAppointment(db, me, newId))
    } catch (e) {
      // An identical request (same key) that committed a moment ago is the same change, not a conflict.
      if ((e instanceof HttpError && e.code === 'stale_appointment') || pgCode(e) === '23505' || pgCode(e) === '23P01') {
        const twin = await replay()
        if (twin) return reply.code(200).send(await loadAppointment(db, me, twin.id))
      }
      if (e instanceof HttpError && e.statusCode === 409) await refuse(req, 'reschedule', old, e)
      if (pgCode(e) === '23P01') await audit(db, req, { action: 'appointment.reschedule', outcome: 'failure', entityType: 'appointment', entityId: old.id, patientId: old.patientId, details: { code: pgConstraint(e) === 'appointments_patient_no_overlap' ? 'patient_double_booked' : 'slot_taken' } })
      return slotConflict(e)
    }
  })

  // ---- Cancel ----
  app.post('/api/appointments/:id/cancel', manage, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(CancelAppointmentRequest, req.body)
    const a = await getAppointmentOr404(db, me, id)
    if (a.status !== 'booked') await refuse(req, 'cancel', a, closedError(a))
    if (a.version !== body.version) await refuse(req, 'cancel', a, staleError())
    try {
      const queued = await db.transaction(async (tx) => {
        await setLifecycleContext(tx, { actorId: me.id, source: 'cancellation', reason: body.reason })
        const [row] = await tx
          .update(appointments)
          .set({ status: 'cancelled', statusReason: body.reason, version: sql`${appointments.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(appointments.id, a.id), eq(appointments.version, body.version), eq(appointments.status, 'booked')))
          .returning()
        if (!row) throw staleError()
        const q = await enqueueNotification(tx, { facilityId: me.facilityId, patientId: a.patientId, appointmentId: a.id, kind: 'appointment.cancelled', payload: await payloadFor(tx, row) })
        // The reason stays on the appointment and its history, not in the audit log.
        await audit(tx, req, { action: 'appointment.cancel', entityType: 'appointment', entityId: a.id, patientId: a.patientId, details: { scheduledAt: a.scheduledAt.toISOString() } })
        return q
      })
      await deliver(req, a, queued ? [queued] : [])
    } catch (e) {
      if (e instanceof HttpError && e.statusCode === 409) await refuse(req, 'cancel', a, e)
      throw e
    }
    return loadAppointment(db, me, a.id)
  })

  // ---- Did not attend ----
  app.post('/api/appointments/:id/no-show', manage, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(NoShowAppointmentRequest, req.body)
    const a = await getAppointmentOr404(db, me, id)
    if (a.status !== 'booked') await refuse(req, 'no_show', a, closedError(a))
    if (a.version !== body.version) await refuse(req, 'no_show', a, staleError())
    if (a.scheduledAt.getTime() > Date.now()) await refuse(req, 'no_show', a, new HttpError(409, 'appointment_not_started', 'This appointment has not started yet. Cancel or reschedule it instead.'))
    try {
      await db.transaction(async (tx) => {
        await setLifecycleContext(tx, { actorId: me.id, source: 'no_show', reason: body.reason ?? null })
        const [row] = await tx
          .update(appointments)
          .set({ status: 'no_show', statusReason: body.reason ?? null, version: sql`${appointments.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(appointments.id, a.id), eq(appointments.version, body.version), eq(appointments.status, 'booked')))
          .returning({ id: appointments.id })
        if (!row) throw staleError()
        await audit(tx, req, { action: 'appointment.no_show', entityType: 'appointment', entityId: a.id, patientId: a.patientId, details: { scheduledAt: a.scheduledAt.toISOString() } })
      })
    } catch (e) {
      if (e instanceof HttpError && e.statusCode === 409) await refuse(req, 'no_show', a, e)
      throw e
    }
    return loadAppointment(db, me, a.id)
  })

  // ---- Check in: create or link exactly one visit ----
  app.post('/api/appointments/:id/check-in', manage, async (req): Promise<CheckInResult> => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(CheckInAppointmentRequest, req.body ?? {})
    const first = await getAppointmentOr404(db, me, id)
    let outcome: CheckInOutcome
    try {
      outcome = await db.transaction(async (tx) => {
        await setLifecycleContext(tx, { actorId: me.id, source: 'appointment_check_in' })
        // The appointment row is locked: a second check-in of it waits here and then sees the first one's result.
        const [a] = await tx.select().from(appointments).where(and(eq(appointments.id, id), eq(appointments.facilityId, me.facilityId))).for('update')
        if (!a) throw staleError()
        if (a.visitId && (a.status === 'checked_in' || a.status === 'completed')) return 'already_checked_in' as const
        if (a.status !== 'booked') throw closedError(a)
        if (body.version !== undefined && a.version !== body.version) throw staleError()
        const clock = await facilityClock(tx, me.facilityId)
        const day = ((await tx.execute(sql`select to_char(${a.scheduledAt.toISOString()}::timestamptz at time zone ${clock.timezone}, 'YYYY-MM-DD') as day`)).rows as { day: string }[])[0]!.day
        if (day !== clock.today) {
          throw new HttpError(409, 'appointment_wrong_day', day < clock.today ? 'This appointment was for an earlier day. Mark it as did not attend, or reschedule it.' : 'Patients are checked in on the day of the appointment.')
        }

        // The patient may already be in today's queue (a walk-in, or an earlier check-in): join that visit, never a second one.
        const openVisit = async () =>
          (
            await tx
              .select()
              .from(visits)
              .where(and(eq(visits.patientId, a.patientId), eq(visits.visitDate, clock.today), inArray(visits.status, OPEN_VISIT_STATUSES)))
              .for('update')
          )[0]
        const adopt = async (v: NonNullable<Awaited<ReturnType<typeof openVisit>>>) => {
          const [other] = await tx.select({ id: appointments.id }).from(appointments).where(and(eq(appointments.visitId, v.id), ne(appointments.id, a.id)))
          if (other) throw new HttpError(409, 'visit_linked_elsewhere', 'The patient is already checked in for another appointment today. Finish or close that visit first.')
          return v
        }
        let visit = await openVisit()
        let result: CheckInOutcome = 'linked_open_visit'
        if (visit) visit = await adopt(visit)
        else {
          try {
            // In a savepoint: losing a race to a walk-in check-in must not abort this transaction.
            visit = await tx.transaction((sp) => createVisit(sp, me, { patientId: a.patientId, departmentId: a.departmentId, assignedDoctorId: a.doctorId, chiefComplaint: a.reason }, clock.today))
            result = 'created_visit'
          } catch (e) {
            if (pgCode(e) !== '23505' || pgConstraint(e) !== 'visits_one_open_per_day_uq') throw e
            const raced = await openVisit()
            if (!raced) throw e
            visit = await adopt(raced)
          }
        }
        const [linked] = await tx
          .update(appointments)
          .set({ status: 'checked_in', visitId: visit!.id, version: sql`${appointments.version} + 1`, updatedAt: sql`now()` })
          .where(and(eq(appointments.id, a.id), eq(appointments.status, 'booked')))
          .returning({ id: appointments.id })
        if (!linked) throw staleError()
        // Both audit events are the last statements of the transaction (the audit chain lock is held only from here to the commit).
        if (result === 'created_visit') await audit(tx, req, { action: 'visit.create', entityType: 'visit', entityId: visit!.id, patientId: a.patientId, details: { token: visit!.tokenNumber, visitDate: clock.today, appointmentId: a.id } })
        await audit(tx, req, { action: 'appointment.check_in', entityType: 'appointment', entityId: a.id, patientId: a.patientId, details: { visitId: visit!.id, outcome: result } })
        return result
      })
    } catch (e) {
      if (e instanceof HttpError && e.statusCode === 409) await refuse(req, 'check_in', first, e)
      if (pgCode(e) === '23505' && pgConstraint(e) === 'appointments_visit_uq') await refuse(req, 'check_in', first, new HttpError(409, 'visit_linked_elsewhere', 'The patient is already checked in for another appointment today. Finish or close that visit first.'))
      throw e
    }
    const appointment = await loadAppointment(db, me, id)
    // Repeating a check-in changes nothing, but it is still a request that shows who the patient is: it leaves its trace too
    // (with the visit it found: `first` was read before another request may have made it).
    if (outcome === 'already_checked_in') await audit(db, req, { action: 'appointment.check_in', entityType: 'appointment', entityId: id, patientId: first.patientId, details: { visitId: appointment.visit?.id ?? null, outcome } })
    return { appointment, visit: appointment.visit!, outcome }
  })

  // ---- Retry messages that were not delivered ----
  app.post('/api/appointments/:id/notifications/retry', manage, async (req): Promise<RetryNotificationsResult> => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const a = await getAppointmentOr404(db, me, id)
    const pending = await undeliveredFor(db, id)
    const sum = await dispatchAll(db, channel, pending, me.id, (e) => req.log.error({ code: pgCode(e) }, 'notification attempt failed'))
    await audit(db, req, { action: 'notification.retry', outcome: sum.failed ? 'failure' : 'success', entityType: 'appointment', entityId: id, patientId: a.patientId, details: { ...sum, channel: channel.name } })
    const rows = await db.select().from(notifications).where(eq(notifications.appointmentId, id)).orderBy(desc(notifications.createdAt))
    return {
      retried: sum.attempted,
      notifications: rows.map((n) => toStaffNotification(n, a.status)),
    }
  })
}
