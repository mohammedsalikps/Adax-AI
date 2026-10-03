import crypto from 'node:crypto'
import { Writable } from 'node:stream'
import { Appointment, notificationText, PatientDetail, PortalAppointmentList, PortalNotifications, RetryNotificationsResult } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { addDays } from '../src/appointments/schedule.ts'
import { dispatchNotification, inAppChannel, type NotificationChannel } from '../src/appointments/notifications.ts'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient } from './helpers.ts'

/**
 * Slice 4: the notification outbox. The only channel is the patient portal;
 * these tests pin what is recorded, what is retried and never repeated, and
 * what a message may contain.
 */
const logs: string[] = []
const stream = new Writable({
  write(chunk, _enc, done) {
    logs.push(String(chunk))
    done()
  },
})

/** A channel whose outcome the test chooses; "ok" behaves like the portal. */
const stub: NotificationChannel & { mode: 'ok' | 'throw' | 'fail'; calls: number; hold: Promise<void> | null; entered: (() => void) | null } = {
  name: 'in_app',
  mode: 'ok',
  calls: 0,
  hold: null,
  entered: null,
  async deliver(db, n) {
    stub.calls++
    stub.entered?.()
    // A slow channel: the attempt stays in flight until the test lets it finish.
    if (stub.hold) await stub.hold
    if (stub.mode === 'throw') throw new Error(`SECRET-MESSAGE-BODY ${JSON.stringify(n.payload)}`)
    if (stub.mode === 'fail') return { status: 'failed', code: 'delivery_error' }
    return inAppChannel.deliver(db, n)
  },
}
const ctx = createTestApp({ notificationChannel: stub, logger: { stream } })
let fx: Fixture
let nurse = ''
let today = ''

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
  nurse = await login(ctx.app, 't.nurse')
  today = (await call(ctx.app, 'GET', '/api/appointments/options', { cookie: nurse })).json().today
  stub.mode = 'ok'
  stub.calls = 0
  stub.hold = null
  stub.entered = null
  logs.length = 0
})
afterAll(() => ctx.close())

let n = 0
async function newPatient() {
  n++
  return PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: `Note${n}`, phone: `96000${String(n).padStart(5, '0')}` }) })).json())
}
/** Consent, activation code and activation: the patient's portal session cookie. */
async function portalSession(p: PatientDetail) {
  await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'portal_access', method: 'verbal' } })
  const code = (await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })).json().activationCode
  const res = await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: code, password: 'Patient-passphrase-1' } })
  expect(res.statusCode).toBe(201)
  return `adaxai_session=${res.cookies.find((c) => c.name === 'adaxai_session')!.value}`
}
const book = async (patientId: string, over: Record<string, unknown> = {}) =>
  Appointment.parse(
    (await call(ctx.app, 'POST', '/api/appointments', { cookie: nurse, body: { patientId, departmentId: fx.departments.gen, doctorId: null, date: addDays(today, 3), time: '10:00', durationMinutes: 15, reason: null, idempotencyKey: crypto.randomUUID(), ...over } })).json(),
  )
const retry = (id: string, cookie = nurse) => call(ctx.app, 'POST', `/api/appointments/${id}/notifications/retry`, { cookie })
const rows = async (sql: string, params: unknown[] = []) => (await adminQuery(sql, params)).rows as Record<string, any>[]
const note = async (appointmentId: string) => (await rows('SELECT * FROM notifications WHERE appointment_id = $1 ORDER BY created_at', [appointmentId]))
const audits = async (action: string) => rows('SELECT outcome, details FROM audit_events WHERE action = $1 ORDER BY id', [action])
const attempts = async (notificationId: string) => rows('SELECT attempt_no, outcome, code, actor_user_id FROM notification_attempts WHERE notification_id = $1 ORDER BY attempt_no', [notificationId])

describe('delivery to the patient portal', () => {
  it('records an undeliverable message with its reason, retries it once there is an account, and then the patient sees it', async () => {
    const p = await newPatient()
    const a = await book(p.id, { reason: 'Chest pain since morning' })
    let [m] = await note(a.id)
    expect(m).toMatchObject({ kind: 'appointment.booked', channel: 'in_app', status: 'undeliverable', failure_code: 'no_active_portal_account', attempts: 1, delivered_at: null })
    expect(await attempts(m!.id)).toEqual([{ attempt_no: 1, outcome: 'undeliverable', code: 'no_active_portal_account', actor_user_id: null }])

    // Retrying changes nothing while there is still no account, and the attempt is recorded with who asked.
    const again = RetryNotificationsResult.parse((await retry(a.id)).json())
    expect([again.retried, again.notifications[0]!.status, again.notifications[0]!.attempts]).toEqual([1, 'undeliverable', 2])
    expect((await attempts(m!.id)).at(-1)).toMatchObject({ attempt_no: 2, actor_user_id: fx.users.nurse })

    const patient = await portalSession(p)
    const delivered = RetryNotificationsResult.parse((await retry(a.id)).json())
    expect([delivered.retried, delivered.notifications[0]!.status, delivered.notifications[0]!.attempts]).toEqual([1, 'delivered', 3])
    ;[m] = await note(a.id)
    expect(m!.delivered_at).not.toBeNull()
    // Nothing is left to retry, and a delivered message is never attempted again.
    const idle = RetryNotificationsResult.parse((await retry(a.id)).json())
    expect([idle.retried, idle.notifications[0]!.attempts]).toEqual([0, 3])

    const rawInbox = JSON.stringify((await call(ctx.app, 'GET', '/api/portal/notifications', { cookie: patient })).json())
    const inbox = PortalNotifications.parse(JSON.parse(rawInbox))
    expect([inbox.unread, inbox.timezone]).toEqual([1, 'Asia/Kolkata'])
    const shown = inbox.notifications[0]!
    const text = notificationText(shown.kind, shown.payload)
    expect(text.title).toBe('Appointment booked')
    expect(text.message).toMatch(/General Medicine/)
    expect(text.message).toMatch(/10:00 am/)
    // The raw response (not the parsed one: the schema would strip an extra field) holds nothing of the reason.
    expect(rawInbox).not.toMatch(/Chest pain/i)
    expect((await call(ctx.app, 'POST', `/api/portal/notifications/${shown.id}/read`, { cookie: patient })).statusCode).toBe(200)
    expect((await call(ctx.app, 'POST', `/api/portal/notifications/${shown.id}/read`, { cookie: patient })).statusCode).toBe(200)
    const after = PortalNotifications.parse((await call(ctx.app, 'GET', '/api/portal/notifications', { cookie: patient })).json())
    expect([after.unread, after.notifications[0]!.readAt !== null]).toEqual([0, true])
    expect((await rows('SELECT read_at FROM notifications WHERE id = $1', [shown.id]))[0]!.read_at).not.toBeNull()
  })

  it('the portal inbox is ordered by when messages became available, and the booking reason never reaches the patient', async () => {
    const p = await newPatient()
    const early = await book(p.id, { time: '09:00', reason: 'Working impression typed by staff' }) // no portal account yet: not delivered
    const patient = await portalSession(p)
    const late = await book(p.id, { time: '11:00' }) // delivered at once
    expect((await retry(early.id)).statusCode).toBe(200) // delivered now, after `late`
    const inbox = PortalNotifications.parse((await call(ctx.app, 'GET', '/api/portal/notifications', { cookie: patient })).json())
    expect(inbox.unread).toBe(2)
    expect(inbox.notifications.map((x) => x.appointmentId)).toEqual([early.id, late.id])
    expect(inbox.notifications[0]!.deliveredAt >= inbox.notifications[1]!.deliveredAt).toBe(true)
    const mine = JSON.stringify((await call(ctx.app, 'GET', '/api/portal/appointments', { cookie: patient })).json())
    expect(mine).not.toContain('Working impression typed by staff')
    expect(JSON.parse(mine).appointments[0]).not.toHaveProperty('reason')
    // Read ones sort after unread ones.
    await call(ctx.app, 'POST', `/api/portal/notifications/${inbox.notifications[0]!.id}/read`, { cookie: patient })
    const after = PortalNotifications.parse((await call(ctx.app, 'GET', '/api/portal/notifications', { cookie: patient })).json())
    expect([after.unread, after.notifications.map((x) => x.appointmentId)]).toEqual([1, [late.id, early.id]])
  })

  it('simultaneous retries make one attempt between them and deliver once', async () => {
    const p = await newPatient()
    const a = await book(p.id)
    const patient = await portalSession(p)
    const before = (await note(a.id))[0]!
    const results = await Promise.all(Array.from({ length: 6 }, () => retry(a.id)))
    expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200))
    const [m] = await note(a.id)
    expect(m).toMatchObject({ status: 'delivered', attempts: before.attempts + 1 })
    expect((await attempts(m!.id)).length).toBe(m!.attempts)
    expect(PortalNotifications.parse((await call(ctx.app, 'GET', '/api/portal/notifications', { cookie: patient })).json()).notifications).toHaveLength(1)
  })

  it('a retry that arrives while an attempt is still in flight makes no second attempt', async () => {
    const p = await newPatient()
    const a = await book(p.id)
    const patient = await portalSession(p)
    const [before] = await note(a.id)
    // Make the message retryable again without touching its history: it is not delivered yet, as if the account did not exist.
    await adminQuery("UPDATE notifications SET status = 'undeliverable', delivered_at = NULL, failure_code = 'no_active_portal_account' WHERE id = $1", [before!.id])
    let release!: () => void
    stub.hold = new Promise<void>((r) => (release = r))
    const entered = new Promise<void>((r) => (stub.entered = r))
    stub.calls = 0
    const first = retry(a.id)
    await entered // the first attempt is now inside the channel
    let second: Awaited<ReturnType<typeof retry>>
    try {
      second = await retry(a.id)
    } finally {
      release() // always: a failure here must not leave the first attempt holding its row lock and connection
    }
    expect(second.statusCode).toBe(200)
    expect(RetryNotificationsResult.parse(second.json()).retried).toBe(0)
    expect((await first).statusCode).toBe(200)
    const [m] = await note(a.id)
    expect(m).toMatchObject({ status: 'delivered', attempts: before!.attempts + 1 })
    expect(stub.calls).toBe(1)
    expect((await attempts(m!.id)).length).toBe(m!.attempts)
    expect(PortalNotifications.parse((await call(ctx.app, 'GET', '/api/portal/notifications', { cookie: patient })).json()).notifications).toHaveLength(1)
  })

  it('an attempt that fails to record rolls back whole: the count and the attempt log never disagree', async () => {
    const p = await newPatient()
    const a = await book(p.id)
    const [before] = await note(a.id)
    // The attempt log refuses the insert (a clash on the attempt number), so the claim must not stick either.
    await adminQuery('INSERT INTO notification_attempts (notification_id, attempt_no, outcome, code) VALUES ($1, $2, $3, $4)', [before!.id, before!.attempts + 1, 'failed', 'planted'])
    const res = await retry(a.id)
    // The request is answered (the failure is isolated to that message and reported as a failed attempt in the summary and the audit event)...
    expect(res.statusCode).toBe(200)
    expect((await audits('notification.retry')).map((e) => [e.outcome, e.details.failed])).toEqual([['failure', 1]])
    // ...and nothing of the attempt was kept: neither a count nor a log entry beyond the planted one.
    const [after] = await note(a.id)
    expect(after).toMatchObject({ attempts: before!.attempts, status: before!.status })
    const log = await attempts(before!.id)
    expect(log).toHaveLength(before!.attempts + 1)
    expect(log.at(-1)).toMatchObject({ attempt_no: before!.attempts + 1, code: 'planted' })
  })

  it('the patient message status travels with the appointment, so staff learn when the patient was not told', async () => {
    const p = await newPatient()
    const undelivered = await book(p.id)
    expect(undelivered.patientMessage).toEqual({ status: 'undeliverable', code: 'no_active_portal_account' })
    await portalSession(p)
    expect((await retry(undelivered.id)).statusCode).toBe(200)
    const list = (await call(ctx.app, 'GET', '/api/appointments?scope=upcoming', { cookie: nurse })).json()
    expect(list.items.find((x: { id: string }) => x.id === undelivered.id).patientMessage).toEqual({ status: 'delivered', code: null })
  })

  it('a message that is no longer true is not retried: not “booked” for a moved appointment, not “moved” for a cancelled one; a cancellation still is', async () => {
    const p = await newPatient()
    const first = await book(p.id, { time: '09:00' })
    const move = await call(ctx.app, 'POST', `/api/appointments/${first.id}/reschedule`, { cookie: nurse, body: { version: first.version, date: addDays(today, 5), time: '12:00', reason: 'Moved', idempotencyKey: crypto.randomUUID() } })
    const second = Appointment.parse(move.json())
    // Still no portal account, so all of these are undelivered; then the cancellation of the replacement.
    const cancelled = await call(ctx.app, 'POST', `/api/appointments/${second.id}/cancel`, { cookie: nurse, body: { version: second.version, reason: 'Patient asked' } })
    expect(cancelled.statusCode).toBe(200)
    await portalSession(p) // an account now exists: undelivered messages could be delivered
    const stale = RetryNotificationsResult.parse((await retry(first.id)).json())
    expect(stale.retried).toBe(0)
    expect(stale.notifications.map((x) => [x.kind, x.status, x.current])).toEqual([['appointment.booked', 'undeliverable', false]])
    // Of the replacement's two messages only the cancellation still holds: it is retried and delivered; “moved” is not.
    const after = RetryNotificationsResult.parse((await retry(second.id)).json())
    expect(after.retried).toBe(1)
    expect(after.notifications.map((x) => [x.kind, x.status, x.current]).sort()).toEqual([
      ['appointment.cancelled', 'delivered', true],
      ['appointment.rescheduled', 'undeliverable', false],
    ])
    // A message of a live appointment still retries and delivers.
    const q = await newPatient()
    const live = await book(q.id, { time: '10:30' })
    await portalSession(q)
    const fresh = RetryNotificationsResult.parse((await retry(live.id)).json())
    expect(fresh.notifications.map((x) => [x.kind, x.status, x.current])).toEqual([['appointment.booked', 'delivered', true]])
  })

  it('a message that stopped being true is not delivered even when an attempt reaches it directly (checked under the lock)', async () => {
    const p = await newPatient()
    const a = await book(p.id, { time: '09:00' })
    await call(ctx.app, 'POST', `/api/appointments/${a.id}/cancel`, { cookie: nurse, body: { version: a.version, reason: 'Patient asked' } })
    await portalSession(p)
    const [booked] = (await note(a.id)).filter((m) => m.kind === 'appointment.booked')
    const result = await dispatchNotification(ctx.db, inAppChannel, booked!.id, null)
    expect(result).toBeNull()
    expect((await note(a.id)).find((m) => m.kind === 'appointment.booked')).toMatchObject({ status: 'undeliverable', attempts: booked!.attempts })
    expect(await attempts(booked!.id)).toHaveLength(booked!.attempts)
  })

  it('the patient is not shown a missed, never-closed appointment as upcoming', async () => {
    const p = await newPatient()
    const patient = await portalSession(p)
    const missed = await book(p.id, { time: '09:00' })
    const ahead = await book(p.id, { time: '12:00', date: addDays(today, 4) })
    await adminQuery(`SET session_replication_role = replica; UPDATE appointments SET scheduled_at = date_trunc('hour', now()) - interval '2 days' WHERE id = '${missed.id}'`)
    const mine = PortalAppointmentList.parse((await call(ctx.app, 'GET', '/api/portal/appointments', { cookie: patient })).json()).appointments
    expect(mine.map((a) => [a.id, a.status, a.awaitingOutcome]).sort()).toEqual([[ahead.id, 'booked', false], [missed.id, 'booked', true]].sort())
  })

  it('a channel that fails or throws is recorded as a failed attempt; the booking still succeeds; message content never reaches the logs', async () => {
    stub.mode = 'throw'
    const p = await newPatient()
    const res = await call(ctx.app, 'POST', '/api/appointments', { cookie: nurse, body: { patientId: p.id, departmentId: fx.departments.gen, doctorId: null, date: addDays(today, 3), time: '10:00', durationMinutes: 15, reason: 'Private reason', idempotencyKey: crypto.randomUUID() } })
    expect(res.statusCode).toBe(201)
    const a = Appointment.parse(res.json())
    const [m] = await note(a.id)
    expect(m).toMatchObject({ status: 'failed', failure_code: 'delivery_error', attempts: 1 })
    expect(await attempts(m!.id)).toEqual([{ attempt_no: 1, outcome: 'failed', code: 'delivery_error', actor_user_id: null }])
    const [ev] = await rows("SELECT outcome, details FROM audit_events WHERE action = 'notification.dispatch'")
    expect(ev).toMatchObject({ outcome: 'failure', details: { attempted: 1, delivered: 0, undeliverable: 0, failed: 1, channel: 'in_app' } })
    // Neither the thrown message (which echoed the payload) nor the reason is logged or audited.
    expect(logs.join('')).not.toMatch(/SECRET-MESSAGE-BODY|Private reason/)
    expect(JSON.stringify(await rows('SELECT details FROM audit_events'))).not.toMatch(/SECRET-MESSAGE-BODY|Private reason/)

    // A failure is retried when asked: still failing, then fine.
    stub.mode = 'fail'
    expect(RetryNotificationsResult.parse((await retry(a.id)).json()).notifications[0]).toMatchObject({ status: 'failed', attempts: 2, failureCode: 'delivery_error' })
    stub.mode = 'ok'
    await portalSession(p)
    expect(RetryNotificationsResult.parse((await retry(a.id)).json()).notifications[0]).toMatchObject({ status: 'delivered', attempts: 3, failureCode: null })
  })

  it('withdrawn portal consent makes a message undeliverable with that reason', async () => {
    const p = await newPatient()
    await portalSession(p)
    // The account is still on but the consent is withdrawn (as an old or inconsistent record could be).
    await adminQuery("SET session_replication_role = replica; UPDATE consents SET status = 'withdrawn', withdrawn_at = now() WHERE type = 'portal_access'")
    const a = await book(p.id)
    expect((await note(a.id))[0]).toMatchObject({ status: 'undeliverable', failure_code: 'portal_consent_withdrawn' })
  })
})

describe('one message per event', () => {
  it('a retried booking, a repeated cancel and a replayed reschedule queue one message each', async () => {
    const p = await newPatient()
    const body = { patientId: p.id, departmentId: fx.departments.gen, doctorId: null, date: addDays(today, 3), time: '10:00', durationMinutes: 15, reason: null, idempotencyKey: crypto.randomUUID() }
    const first = Appointment.parse((await call(ctx.app, 'POST', '/api/appointments', { cookie: nurse, body })).json())
    await call(ctx.app, 'POST', '/api/appointments', { cookie: nurse, body })
    expect((await note(first.id)).map((x) => x.kind)).toEqual(['appointment.booked'])

    const cancel = { version: first.version, reason: 'Patient asked to cancel' }
    await call(ctx.app, 'POST', `/api/appointments/${first.id}/cancel`, { cookie: nurse, body: cancel })
    await call(ctx.app, 'POST', `/api/appointments/${first.id}/cancel`, { cookie: nurse, body: cancel })
    expect((await note(first.id)).map((x) => x.kind)).toEqual(['appointment.booked', 'appointment.cancelled'])

    const q = await newPatient()
    const old = await book(q.id, { time: '12:00' })
    const move = { version: old.version, date: addDays(today, 5), time: '12:00', reason: 'Patient asked to move it', idempotencyKey: crypto.randomUUID() }
    const moved = (await call(ctx.app, 'POST', `/api/appointments/${old.id}/reschedule`, { cookie: nurse, body: move })).json()
    await call(ctx.app, 'POST', `/api/appointments/${old.id}/reschedule`, { cookie: nurse, body: move })
    expect((await note(moved.id)).map((x) => x.kind)).toEqual(['appointment.rescheduled'])
    expect((await note(old.id)).map((x) => x.kind)).toEqual(['appointment.booked'])
    expect((await note(moved.id))[0]!.payload).toMatchObject({ previousScheduledAt: old.scheduledAt })
    // The database holds the rule too.
    await expect(ctx.pool.query("INSERT INTO notifications (facility_id, patient_id, appointment_id, kind, dedup_key) VALUES ($1, $2, $3, 'appointment.booked', $4)", [fx.facilityId, p.id, first.id, `${first.id}:appointment.booked`])).rejects.toMatchObject({ code: '23505' })
  })

  it('a message carries times, department and clinician only: no reason, diagnosis or other free text', async () => {
    const p = await newPatient()
    const a = await book(p.id, { doctorId: fx.users.doctor, reason: 'Suspected diabetes' })
    await call(ctx.app, 'POST', `/api/appointments/${a.id}/cancel`, { cookie: nurse, body: { version: a.version, reason: 'Patient admitted with pneumonia' } })
    const all = await note(a.id)
    expect(all).toHaveLength(2)
    for (const m of all) {
      expect(Object.keys(m.payload).sort()).toEqual(['departmentName', 'doctorName', 'durationMinutes', 'previousScheduledAt', 'scheduledAt', 'timezone'])
      expect(JSON.stringify(m.payload)).not.toMatch(/diabetes|pneumonia/i)
      const t = notificationText(m.kind, m.payload)
      expect(`${t.title} ${t.message}`).not.toMatch(/diabetes|pneumonia|reason/i)
      expect(t.message).toMatch(/General Medicine with Test t\.doctor/)
    }
    expect(notificationText('appointment.cancelled', all[1]!.payload).message).toMatch(/was cancelled\. Contact the clinic/)
    expect(JSON.stringify(await rows("SELECT details FROM audit_events WHERE action LIKE 'notification.%' OR action LIKE 'appointment.%'"))).not.toMatch(/diabetes|pneumonia/i)
  })
})

describe('the patient’s own view', () => {
  it('shows only the patient’s own appointments on the clinic’s clock, and only their own messages', async () => {
    const [a, b] = [await newPatient(), await newPatient()]
    const [pa, pb] = [await portalSession(a), await portalSession(b)]
    const mine = await book(a.id, { time: '23:30', doctorId: fx.users.doctor, reason: 'Check-up' })
    const theirs = await book(b.id, { time: '11:00', reason: 'Skin rash' })
    const old = await book(a.id, { time: '14:00', date: addDays(today, 4) })
    await call(ctx.app, 'POST', `/api/appointments/${old.id}/reschedule`, { cookie: nurse, body: { version: old.version, date: addDays(today, 6), time: '14:00', reason: 'Patient asked to move it', idempotencyKey: crypto.randomUUID() } })

    const rawList = JSON.stringify((await call(ctx.app, 'GET', '/api/portal/appointments', { cookie: pa })).json())
    const list = PortalAppointmentList.parse(JSON.parse(rawList))
    // The moved appointment appears once, at its new time; nothing of the other patient is there.
    expect(list.appointments.map((x) => `${x.localDate} ${x.localTime} ${x.status}`)).toEqual([`${addDays(today, 6)} 14:00 booked`, `${addDays(today, 3)} 23:30 booked`])
    expect(list.appointments.find((x) => x.id === mine.id)).toMatchObject({ timezone: 'Asia/Kolkata', departmentName: 'General Medicine', doctorName: 'Test t.doctor', durationMinutes: 15 })
    expect(rawList).not.toMatch(/Skin rash|Check-up/)

    const inboxA = PortalNotifications.parse((await call(ctx.app, 'GET', '/api/portal/notifications', { cookie: pa })).json())
    const inboxB = PortalNotifications.parse((await call(ctx.app, 'GET', '/api/portal/notifications', { cookie: pb })).json())
    expect(inboxA.notifications.map((x) => x.appointmentId).sort()).toEqual([mine.id, old.id, (await rows("SELECT id FROM appointments WHERE rescheduled_from = $1", [old.id]))[0]!.id].sort())
    expect(inboxB.notifications.map((x) => x.appointmentId)).toEqual([theirs.id])

    // Another patient's message is "not found", the attempt is audited, and nothing was marked read.
    const probe = await call(ctx.app, 'POST', `/api/portal/notifications/${inboxB.notifications[0]!.id}/read`, { cookie: pa })
    expect(probe.statusCode).toBe(404)
    expect((await rows("SELECT read_at FROM notifications WHERE id = $1", [inboxB.notifications[0]!.id]))[0]!.read_at).toBeNull()
    expect((await rows("SELECT outcome, patient_id, details FROM audit_events WHERE action = 'portal.read' AND outcome = 'denied'"))).toEqual([{ outcome: 'denied', patient_id: a.id, details: { what: 'notification', reason: 'not_found_or_not_owned' } }])
    // A patient has no way to the staff schedule.
    for (const [method, url] of [['GET', '/api/appointments'], ['GET', `/api/appointments/${theirs.id}`], ['POST', `/api/appointments/${mine.id}/cancel`], ['POST', `/api/appointments/${mine.id}/notifications/retry`]] as const) {
      expect((await call(ctx.app, method, url, { cookie: pa, ...(method === 'POST' && { body: {} }) })).statusCode, url).toBe(403)
    }
    expect((await rows("SELECT count(*)::int AS n FROM audit_events WHERE action = 'portal.read' AND details->>'what' IN ('appointments', 'notifications')"))[0]!.n).toBe(3)
  })

  it('switching the portal off stops messages being shown; undelivered ones wait for a new account', async () => {
    const p = await newPatient()
    const patient = await portalSession(p)
    const a = await book(p.id)
    expect((await note(a.id))[0]!.status).toBe('delivered')
    // The patient withdraws portal access: the account is switched off, and the portal answers 401/403.
    const consent = (await rows("SELECT id FROM consents WHERE type = 'portal_access'"))[0]!.id
    await call(ctx.app, 'POST', `/api/portal/consents/${consent}/withdraw`, { cookie: patient, body: {} })
    expect([401, 403]).toContain((await call(ctx.app, 'GET', '/api/portal/notifications', { cookie: patient })).statusCode)
    const b = await book(p.id, { time: '12:00' })
    expect((await note(b.id))[0]).toMatchObject({ status: 'undeliverable', failure_code: 'no_active_portal_account' })
  })
})
