import { APPOINTMENT_TRANSITIONS, type AppointmentStatus, PatientDetail, Visit } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient } from './helpers.ts'

/**
 * Slice 4, database layer: what the appointment tables enforce by themselves,
 * whatever the API does. Statements run as the application role inside a
 * transaction that names the acting user, as the API does; setup that the
 * rules would refuse (an old state) is written as the test superuser with
 * triggers bypassed.
 */
const ctx = createTestApp()
let fx: Fixture
let nurse = ''

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
  nurse = await login(ctx.app, 't.nurse')
})
afterAll(() => ctx.close())

let n = 0
async function newPatient() {
  n++
  return PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: `Slot${n}`, phone: `94000${String(n).padStart(5, '0')}` }) })).json())
}
async function newVisit(patientId: string) {
  return Visit.parse((await call(ctx.app, 'POST', '/api/visits', { cookie: nurse, body: { patientId, departmentId: fx.departments.gen } })).json())
}

/** Runs statements as the application role in one transaction, naming `actor` (undefined: no actor named). */
async function asApp<T>(actor: string | undefined, fn: (q: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>) => Promise<T>, source = 'booking'): Promise<T> {
  const c = await ctx.pool.connect()
  try {
    await c.query('BEGIN')
    if (actor) await c.query("SELECT set_config('adaxai.actor_id', $1, true), set_config('adaxai.source', $2, true)", [actor, source])
    const out = await fn((sql, params) => c.query(sql, params))
    await c.query('COMMIT')
    return out
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    c.release()
  }
}

const T = (h: number, m = 0) => `2030-01-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`
const INSERT = 'INSERT INTO appointments (facility_id, patient_id, department_id, doctor_id, scheduled_at, duration_minutes, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id'
const book = (q: Parameters<Parameters<typeof asApp>[1]>[0], patientId: string, doctorId: string | null, at: string, minutes = 15) =>
  q(INSERT, [fx.facilityId, patientId, fx.departments.gen, doctorId, at, minutes, fx.users.nurse]).then((r) => r.rows[0]!.id as string)

/** A row in a given state, written without the guards (the state an old or tampered database could hold). */
async function seedRow(status: string, patientId: string, at: string, extra: { visitId?: string; rescheduledTo?: string; reason?: string } = {}) {
  // Several statements in one call: pg answers with one result per statement; the INSERT is the last.
  const results = (await adminQuery(
    `SET session_replication_role = replica;
     INSERT INTO appointments (facility_id, patient_id, department_id, doctor_id, scheduled_at, duration_minutes, status, visit_id, rescheduled_to, status_reason, created_by)
     VALUES ('${fx.facilityId}', '${patientId}', '${fx.departments.gen}', NULL, '${at}', 15, '${status}', ${extra.visitId ? `'${extra.visitId}'` : 'NULL'}, ${extra.rescheduledTo ? `'${extra.rescheduledTo}'` : 'NULL'}, ${extra.reason ? `'${extra.reason}'` : 'NULL'}, '${fx.users.nurse}') RETURNING id`,
  )) as unknown as { rows: { id: string }[] }[]
  return results.at(-1)!.rows[0]!.id
}

describe('no double booking', () => {
  it('a doctor cannot hold two overlapping slots; back-to-back and other doctors are fine; a closed slot is released', async () => {
    const [a, b, c] = [await newPatient(), await newPatient(), await newPatient()]
    await asApp(fx.users.nurse, async (q) => {
      await book(q, a.id, fx.users.doctor, T(4, 0), 30)
    })
    const overlap = (patientId: string, doctor: string | null, at: string, mins = 15) => asApp(fx.users.nurse, (q) => book(q, patientId, doctor, at, mins))
    await expect(overlap(b.id, fx.users.doctor, T(4, 15))).rejects.toMatchObject({ code: '23P01', constraint: 'appointments_doctor_no_overlap' })
    await expect(overlap(b.id, fx.users.doctor, T(3, 50), 15)).rejects.toMatchObject({ constraint: 'appointments_doctor_no_overlap' })
    await expect(overlap(b.id, fx.users.doctor, T(3, 45), 30)).rejects.toMatchObject({ constraint: 'appointments_doctor_no_overlap' })
    // [start, end): a slot that starts when the other ends does not overlap, nor one that ends when it starts.
    await expect(overlap(b.id, fx.users.doctor, T(4, 30))).resolves.toBeTruthy()
    await expect(overlap(c.id, fx.users.doctor, T(3, 45))).resolves.toBeTruthy()
    // Another doctor, or no doctor, is free at the same time.
    await expect(overlap(c.id, fx.users.doctor2, T(4, 0))).resolves.toBeTruthy()
    await expect(overlap((await newPatient()).id, null, T(4, 0))).resolves.toBeTruthy()
  })

  it('a patient cannot be in two places at once, whoever the doctor is; cancelling releases the slot', async () => {
    const p = await newPatient()
    const first = await asApp(fx.users.nurse, (q) => book(q, p.id, fx.users.doctor, T(5, 0)))
    await expect(asApp(fx.users.nurse, (q) => book(q, p.id, fx.users.doctor2, T(5, 10)))).rejects.toMatchObject({ code: '23P01', constraint: 'appointments_patient_no_overlap' })
    await expect(asApp(fx.users.nurse, (q) => book(q, p.id, null, T(5, 0)))).rejects.toMatchObject({ constraint: 'appointments_patient_no_overlap' })
    await asApp(fx.users.nurse, (q) => q("UPDATE appointments SET status = 'cancelled', status_reason = 'Patient asked', version = version + 1 WHERE id = $1", [first]), 'cancellation')
    await expect(asApp(fx.users.nurse, (q) => book(q, p.id, fx.users.doctor2, T(5, 10)))).resolves.toBeTruthy()
  })

  it('two bookings for the same slot at the same moment: exactly one wins', async () => {
    const [a, b] = [await newPatient(), await newPatient()]
    const results = await Promise.allSettled([asApp(fx.users.nurse, (q) => book(q, a.id, fx.users.doctor, T(6, 0))), asApp(fx.users.nurse, (q) => book(q, b.id, fx.users.doctor, T(6, 0)))])
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    // Two raw inserts that conflict can also be broken up by PostgreSQL's deadlock detector (40P01) instead of the
    // exclusion check (23P01); either way exactly one is refused. The API serialises bookings (lockSchedule) so its
    // callers always get the exclusion error: see appointments-concurrency.test.ts.
    expect(['23P01', '40P01']).toContain((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code)
  })
})

describe('what a booking must look like', () => {
  it('starts booked, by the acting user, for a patient, department and doctor of the same facility, on a five-minute slot', async () => {
    const p = await newPatient()
    // No acting user named: refused.
    await expect(asApp(undefined, (q) => book(q, p.id, null, T(7, 0)))).rejects.toMatchObject({ code: 'AX002' })
    // Created by someone other than the acting user.
    await expect(asApp(fx.users.doctor, (q) => q(INSERT, [fx.facilityId, p.id, fx.departments.gen, null, T(7, 0), 15, fx.users.nurse]))).rejects.toMatchObject({ code: 'AX006' })
    // Not a starting status, or a visit already attached.
    await expect(asApp(fx.users.nurse, (q) => q("INSERT INTO appointments (facility_id, patient_id, department_id, scheduled_at, duration_minutes, status, created_by) VALUES ($1, $2, $3, $4, 15, 'completed', $5)", [fx.facilityId, p.id, fx.departments.gen, T(7, 0), fx.users.nurse]))).rejects.toMatchObject({ code: 'AX006' })
    // A nurse is not a clinician; another facility's patient, department or doctor is refused.
    await expect(asApp(fx.users.nurse, (q) => book(q, p.id, fx.users.nurse, T(7, 0)))).rejects.toMatchObject({ code: 'AX006' })
    const [f2] = (await adminQuery("INSERT INTO facilities (code, name) VALUES ('OTHER', 'Other') RETURNING id")).rows as { id: string }[]
    const [d2] = (await adminQuery(`INSERT INTO departments (facility_id, code, name) VALUES ('${f2!.id}', 'GEN', 'Other GEN') RETURNING id`)).rows as { id: string }[]
    await expect(asApp(fx.users.nurse, (q) => q(INSERT, [f2!.id, p.id, d2!.id, null, T(7, 0), 15, fx.users.nurse]))).rejects.toMatchObject({ code: 'AX006' })
    await expect(asApp(fx.users.nurse, (q) => q(INSERT, [fx.facilityId, p.id, d2!.id, null, T(7, 0), 15, fx.users.nurse]))).rejects.toMatchObject({ code: 'AX006' })
    // Slot rules: minutes aligned to five, a sane duration.
    await expect(asApp(fx.users.nurse, (q) => book(q, p.id, null, '2030-01-15T07:02:00Z'))).rejects.toMatchObject({ code: '23514', constraint: 'appointments_slot_check' })
    await expect(asApp(fx.users.nurse, (q) => book(q, p.id, null, T(7, 0), 3))).rejects.toMatchObject({ constraint: 'appointments_duration_check' })
    await expect(asApp(fx.users.nurse, (q) => book(q, p.id, null, T(7, 0), 241))).rejects.toMatchObject({ constraint: 'appointments_duration_check' })
    await expect(asApp(fx.users.nurse, (q) => book(q, p.id, null, T(7, 0)))).resolves.toBeTruthy()
  })

  it('a booking never changes: only its status moves, and it is never deleted', async () => {
    const p = await newPatient()
    const id = await asApp(fx.users.nurse, (q) => book(q, p.id, fx.users.doctor, T(8, 0)))
    for (const [col, val] of [['scheduled_at', T(9, 0)], ['duration_minutes', 30], ['doctor_id', fx.users.doctor2], ['patient_id', (await newPatient()).id], ['reason', 'changed'], ['created_by', fx.users.doctor]] as const) {
      await expect(asApp(fx.users.nurse, (q) => q(`UPDATE appointments SET ${col} = $2 WHERE id = $1`, [id, val])), col).rejects.toMatchObject({ code: 'AX006' })
    }
    await expect(asApp(fx.users.nurse, (q) => q('DELETE FROM appointments WHERE id = $1', [id]))).rejects.toMatchObject({ code: 'AX007' })
    // Not even a no-op change of other columns together with nothing.
    await expect(asApp(fx.users.nurse, (q) => q("UPDATE appointments SET status_reason = 'x' WHERE id = $1", [id]))).rejects.toMatchObject({ code: 'AX006' })
  })
})

describe('appointment state machine in the database', () => {
  it('allows exactly booked -> checked_in | cancelled | rescheduled | no_show and checked_in -> completed | cancelled | no_show', async () => {
    // The expectation comes from the contract, so the API's and the database's rules cannot drift apart.
    const STATUSES = Object.keys(APPOINTMENT_TRANSITIONS) as AppointmentStatus[]
    const allowed = new Set(STATUSES.flatMap((from) => APPOINTMENT_TRANSITIONS[from].map((to) => `${from}>${to}`)))
    expect(allowed.size).toBe(7)
    const patient = await newPatient()
    const visit = await newVisit(patient.id)
    const replacement = await seedRow('booked', (await newPatient()).id, T(11, 0))
    let slot = 0
    const seen = new Set<string>()
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (from === to) continue
        slot++
        const p = await newPatient()
        const v = from === 'checked_in' || from === 'completed' ? await newVisit(p.id) : null
        const id = await seedRow(from, p.id, T(12 + Math.floor(slot / 12), (slot % 12) * 5), { ...(v && { visitId: v.id }), ...(from === 'rescheduled' && { rescheduledTo: replacement }), ...(from === 'cancelled' && { reason: 'Earlier' }) })
        const set = [`status = '${to}'`, 'version = version + 1']
        if (to === 'cancelled') set.push("status_reason = 'Reason given'")
        if (to === 'rescheduled') set.push(`rescheduled_to = '${replacement}'`)
        // Moving to checked_in needs the visit it joins (the link itself is a row constraint).
        const tmpVisit = to === 'checked_in' ? await newVisit((await newPatient()).id) : null
        if (tmpVisit) set.push(`visit_id = '${tmpVisit.id}'`)
        try {
          await asApp(fx.users.nurse, (q) => q(`UPDATE appointments SET ${set.join(', ')} WHERE id = $1`, [id]), 'test')
          seen.add(`${from}>${to}`)
        } catch (e) {
          const code = (e as { code: string }).code
          // Refused by the state machine (closed, or not a listed move), or by a row check on the combination.
          expect(['AX006', 'AX007', '23514'], `${from}>${to}: ${code}`).toContain(code)
          if (allowed.has(`${from}>${to}`)) throw new Error(`${from}>${to} should be allowed but failed with ${code}`)
        }
      }
    }
    expect([...seen].sort()).toEqual([...allowed].sort())
    expect(visit.id).toBeTruthy()
  })

  it('closed appointments are frozen, and a status change must name the acting user', async () => {
    const p = await newPatient()
    const closed = await seedRow('no_show', p.id, T(14, 0))
    await expect(asApp(fx.users.nurse, (q) => q('UPDATE appointments SET version = version + 1 WHERE id = $1', [closed]))).rejects.toMatchObject({ code: 'AX007' })
    const booked = await seedRow('booked', (await newPatient()).id, T(15, 0))
    await expect(asApp(undefined, (q) => q("UPDATE appointments SET status = 'no_show', version = version + 1 WHERE id = $1", [booked]))).rejects.toMatchObject({ code: 'AX002' })
  })

  it('a replacement must be named by an appointment that was rescheduled to it, for the same patient', async () => {
    const [a, b] = [await newPatient(), await newPatient()]
    const old = await asApp(fx.users.nurse, (q) => book(q, a.id, fx.users.doctor, T(16, 0)))
    const newId = '00000000-0000-4000-8000-0000000000aa'
    // Without the old appointment naming it first: refused.
    await expect(asApp(fx.users.nurse, (q) => q('INSERT INTO appointments (id, facility_id, patient_id, department_id, scheduled_at, duration_minutes, created_by, rescheduled_from) VALUES ($1, $2, $3, $4, $5, 15, $6, $7)', [newId, fx.facilityId, a.id, fx.departments.gen, T(17, 0), fx.users.nurse, old]), 'reschedule')).rejects.toMatchObject({ code: 'AX006' })
    // In one transaction, in order: the old one is released first, then the replacement takes the slot.
    await asApp(
      fx.users.nurse,
      async (q) => {
        await q("UPDATE appointments SET status = 'rescheduled', status_reason = 'Patient asked', rescheduled_to = $2, version = version + 1 WHERE id = $1", [old, newId])
        await q('INSERT INTO appointments (id, facility_id, patient_id, department_id, doctor_id, scheduled_at, duration_minutes, created_by, rescheduled_from) VALUES ($1, $2, $3, $4, $5, $6, 15, $7, $8)', [newId, fx.facilityId, a.id, fx.departments.gen, fx.users.doctor, T(16, 0), fx.users.nurse, old])
      },
      'reschedule',
    )
    // Another patient's replacement chain is refused.
    const old2 = await asApp(fx.users.nurse, (q) => book(q, b.id, fx.users.doctor2, T(18, 0)))
    const bad = '00000000-0000-4000-8000-0000000000bb'
    await expect(
      asApp(
        fx.users.nurse,
        async (q) => {
          await q("UPDATE appointments SET status = 'rescheduled', status_reason = 'x', rescheduled_to = $2, version = version + 1 WHERE id = $1", [old2, bad])
          await q('INSERT INTO appointments (id, facility_id, patient_id, department_id, scheduled_at, duration_minutes, created_by, rescheduled_from) VALUES ($1, $2, $3, $4, $5, 15, $6, $7)', [bad, fx.facilityId, a.id, fx.departments.gen, T(19, 0), fx.users.nurse, old2])
        },
        'reschedule',
      ),
    ).rejects.toMatchObject({ code: 'AX006' })
    const { rows } = await adminQuery('SELECT status, rescheduled_to FROM appointments WHERE id = $1', [old])
    expect(rows[0]).toMatchObject({ status: 'rescheduled', rescheduled_to: newId })
  })
})

describe('status history and the visit', () => {
  it('records who changed what, when, from where and why; the history cannot be rewritten', async () => {
    const p = await newPatient()
    const id = await asApp(fx.users.nurse, (q) => book(q, p.id, fx.users.doctor, T(9, 0)))
    await asApp(fx.users.doctor, (q) => q("UPDATE appointments SET status = 'cancelled', status_reason = 'Doctor unavailable', version = version + 1 WHERE id = $1", [id]), 'cancellation')
    const { rows } = await adminQuery('SELECT from_status, to_status, source, reason, actor_user_id FROM appointment_status_events WHERE appointment_id = $1 ORDER BY id', [id])
    expect(rows).toEqual([
      { from_status: null, to_status: 'booked', source: 'booking', reason: null, actor_user_id: fx.users.nurse },
      { from_status: 'booked', to_status: 'cancelled', source: 'cancellation', reason: 'Doctor unavailable', actor_user_id: fx.users.doctor },
    ])
    await expect(ctx.pool.query('UPDATE appointment_status_events SET reason = $1', ['rewritten'])).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query('DELETE FROM appointment_status_events')).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query('TRUNCATE appointment_status_events')).rejects.toMatchObject({ code: '42501' })
  })

  it('a checked-in appointment follows its visit to the end, with its own history and the visit’s reason', async () => {
    const [a, b, c] = [await newPatient(), await newPatient(), await newPatient()]
    const [va, vb, vc] = [await newVisit(a.id), await newVisit(b.id), await newVisit(c.id)]
    const link = async (patientId: string, visitId: string, at: string) => {
      const id = await asApp(fx.users.nurse, (q) => book(q, patientId, null, at))
      await asApp(fx.users.nurse, (q) => q("UPDATE appointments SET status = 'checked_in', visit_id = $2, version = version + 1 WHERE id = $1", [id, visitId]), 'appointment_check_in')
      return id
    }
    const [ia, ib, ic] = [await link(a.id, va.id, T(20, 0)), await link(b.id, vb.id, T(20, 15)), await link(c.id, vc.id, T(20, 30))]
    // The queue closes two visits; the third is completed (a signed consultation does this: see lifecycle tests).
    await asApp(fx.users.nurse, (q) => q("UPDATE visits SET status = 'cancelled', status_reason = 'Patient left', status_changed_at = now() WHERE id = $1", [va.id]), 'queue')
    await asApp(fx.users.nurse, (q) => q("UPDATE visits SET status = 'no_show', status_changed_at = now() WHERE id = $1", [vb.id]), 'queue')
    await asApp(fx.users.nurse, async (q) => {
      await q("UPDATE visits SET status = 'ready' WHERE id = $1", [vc.id])
    }, 'queue')
    const state = async (id: string) => (await adminQuery('SELECT status, status_reason FROM appointments WHERE id = $1', [id])).rows[0]
    expect(await state(ia)).toEqual({ status: 'cancelled', status_reason: 'Patient left' })
    expect(await state(ib)).toEqual({ status: 'no_show', status_reason: null })
    expect(await state(ic)).toEqual({ status: 'checked_in', status_reason: null })
    const events = (await adminQuery("SELECT to_status, source, reason, actor_user_id FROM appointment_status_events WHERE appointment_id = $1 AND from_status = 'checked_in'", [ia])).rows
    expect(events).toEqual([{ to_status: 'cancelled', source: 'visit_status', reason: 'Patient left', actor_user_id: fx.users.nurse }])
    // The source of the visit's own history is untouched by the appointment trigger.
    expect((await adminQuery("SELECT source FROM visit_status_events WHERE visit_id = $1 AND to_status = 'cancelled'", [va.id])).rows).toEqual([{ source: 'queue' }])
  })
})

describe('notification outbox in the database', () => {
  it('queues each message once per key, never rewrites or deletes it, keeps delivered messages delivered, and appends attempts', async () => {
    const p = await newPatient()
    const insert = () =>
      ctx.pool.query("INSERT INTO notifications (facility_id, patient_id, kind, dedup_key, payload) VALUES ($1, $2, 'appointment.booked', 'k:1', '{\"a\":1}') RETURNING id", [fx.facilityId, p.id])
    const id = (await insert()).rows[0].id as string
    await expect(insert()).rejects.toMatchObject({ code: '23505', constraint: 'notifications_dedup_uq' })
    await expect(ctx.pool.query("UPDATE notifications SET payload = '{}' WHERE id = $1", [id])).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query("UPDATE notifications SET dedup_key = 'other' WHERE id = $1", [id])).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query('DELETE FROM notifications WHERE id = $1', [id])).rejects.toMatchObject({ code: '42501' })
    // Only a delivered message can be read; delivered needs a time (and the reverse).
    await expect(ctx.pool.query("UPDATE notifications SET read_at = now() WHERE id = $1", [id])).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query("UPDATE notifications SET status = 'delivered' WHERE id = $1", [id])).rejects.toMatchObject({ code: '23514', constraint: 'notifications_delivered_check' })
    await ctx.pool.query("UPDATE notifications SET status = 'undeliverable', failure_code = 'no_active_portal_account', attempts = 1, last_attempt_at = now() WHERE id = $1", [id])
    await expect(ctx.pool.query('UPDATE notifications SET attempts = 0 WHERE id = $1', [id])).rejects.toMatchObject({ code: '42501' })
    await ctx.pool.query("UPDATE notifications SET status = 'delivered', delivered_at = now(), failure_code = NULL, attempts = 2 WHERE id = $1", [id])
    await expect(ctx.pool.query("UPDATE notifications SET status = 'failed', delivered_at = NULL WHERE id = $1", [id])).rejects.toMatchObject({ code: '42501' })
    await ctx.pool.query('UPDATE notifications SET read_at = now() WHERE id = $1', [id])
    await expect(ctx.pool.query('UPDATE notifications SET read_at = now() + interval \'1 day\' WHERE id = $1', [id])).rejects.toMatchObject({ code: '42501' })
    // Attempts: numbered per message, append-only.
    await ctx.pool.query("INSERT INTO notification_attempts (notification_id, attempt_no, outcome, code) VALUES ($1, 1, 'undeliverable', 'no_active_portal_account')", [id])
    await expect(ctx.pool.query("INSERT INTO notification_attempts (notification_id, attempt_no, outcome) VALUES ($1, 1, 'delivered')", [id])).rejects.toMatchObject({ code: '23505' })
    await expect(ctx.pool.query("INSERT INTO notification_attempts (notification_id, attempt_no, outcome) VALUES ($1, 2, 'sent')", [id])).rejects.toMatchObject({ constraint: 'notification_attempts_outcome_check' })
    await expect(ctx.pool.query("UPDATE notification_attempts SET outcome = 'failed'")).rejects.toMatchObject({ code: '42501' })
    await expect(ctx.pool.query('DELETE FROM notification_attempts')).rejects.toMatchObject({ code: '42501' })
  })
})
