import crypto from 'node:crypto'
import { Appointment, AppointmentOptions, PatientDetail } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { addDays } from '../src/appointments/schedule.ts'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient } from './helpers.ts'

/**
 * Slice 4, review round 1: simultaneous and repeated requests, and input the
 * calendar cannot hold. A file of its own because every test signs in again
 * after the database is reset, and the sign-in limit is per account and minute.
 */
const ctx = createTestApp()
let fx: Fixture
let nurse = ''
let today = ''

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
  nurse = await login(ctx.app, 't.nurse')
  today = AppointmentOptions.parse((await call(ctx.app, 'GET', '/api/appointments/options', { cookie: nurse })).json()).today
})
afterAll(() => ctx.close())

let n = 0
async function newPatient(over: Record<string, unknown> = {}) {
  n++
  return PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: `Appt${n}`, phone: `95000${String(n).padStart(5, '0')}`, ...over }) })).json())
}
const body = (patientId: string, over: Record<string, unknown> = {}) => ({
  patientId,
  departmentId: fx.departments.gen,
  doctorId: null,
  date: addDays(today, 3),
  time: '10:00',
  durationMinutes: 15,
  reason: null,
  idempotencyKey: crypto.randomUUID(),
  ...over,
})
const book = (b: Record<string, unknown>, cookie = nurse) => call(ctx.app, 'POST', '/api/appointments', { cookie, body: b })
const booked = async (patientId: string, over: Record<string, unknown> = {}) => Appointment.parse((await book(body(patientId, over))).json())
const act = (id: string, action: string, b: Record<string, unknown> = {}, cookie = nurse) => call(ctx.app, 'POST', `/api/appointments/${id}/${action}`, { cookie, body: b })
const rescheduleBody = (a: Appointment, over: Record<string, unknown> = {}) => ({ version: a.version, date: addDays(today, 5), time: '11:00', reason: 'Patient asked to move it', idempotencyKey: crypto.randomUUID(), ...over })

const rows = async (sql: string, params: unknown[] = []) => (await adminQuery(sql, params)).rows as Record<string, any>[]
const audits = async (action: string) => rows('SELECT outcome, patient_id, entity_id, details FROM audit_events WHERE action = $1 ORDER BY id', [action])

describe('concurrency, retries and odd input (review round 1)', () => {
  it('twin reschedules with one key, sent at once, are one change: the second gets the first one’s replacement and no failure is recorded', async () => {
    for (let round = 0; round < 4; round++) {
      const p = await newPatient()
      const old = await booked(p.id, { time: `1${round}:00` })
      const b = rescheduleBody(old, { time: `1${round}:30`, date: addDays(today, 6) })
      const [x, y] = await Promise.all([act(old.id, 'reschedule', b), act(old.id, 'reschedule', b)])
      expect([x.statusCode, y.statusCode].sort(), `round ${round}: ${x.body} ${y.body}`).toEqual([200, 201])
      expect(x.json().id).toBe(y.json().id)
    }
    expect((await audits('appointment.reschedule')).filter((e) => e.outcome !== 'success')).toEqual([])
  })

  it('the same key for two different bookings at once: one is made, the other is told the key was used (never a server error)', async () => {
    const p = await newPatient()
    const key = crypto.randomUUID()
    const [x, y] = await Promise.all([book(body(p.id, { time: '09:00', idempotencyKey: key })), book(body(p.id, { time: '14:00', idempotencyKey: key }))])
    expect([x.statusCode, y.statusCode].sort()).toEqual([201, 409])
    expect([x, y].find((r) => r.statusCode === 409)!.json().error).toBe('idempotency_key_reused')
    expect((await rows('SELECT count(*)::int AS n FROM appointments'))[0]!.n).toBe(1)
  })

  it('many bookings for one clinician and time at once: exactly one wins and the rest are told the slot is taken', async () => {
    const patients = await Promise.all(Array.from({ length: 8 }, () => newPatient()))
    const results = await Promise.all(patients.map((p) => book(body(p.id, { doctorId: fx.users.doctor, time: '08:00' }))))
    expect(results.map((r) => r.statusCode).sort(), results.map((r) => r.body).join('\n')).toEqual([201, 409, 409, 409, 409, 409, 409, 409])
    expect(results.filter((r) => r.statusCode === 409).every((r) => r.json().error === 'slot_taken')).toBe(true)
  })

  it('two clinic staff swapping one clinician’s back-to-back appointments at once never meet a database deadlock', async () => {
    for (let round = 0; round < 3; round++) {
      const [p, q] = [await newPatient(), await newPatient()]
      const date = addDays(today, 7 + round)
      const first = await booked(p.id, { doctorId: fx.users.doctor, date, time: '09:00' })
      const second = await booked(q.id, { doctorId: fx.users.doctor, date, time: '09:15' })
      const results = await Promise.all([act(first.id, 'reschedule', rescheduleBody(first, { date, time: '09:15' })), act(second.id, 'reschedule', rescheduleBody(second, { date, time: '09:00' }))])
      // Each moves onto the other's still-booked slot, so both are refused as a taken slot: not as a deadlock (409 try_again) and not as a server error.
      for (const r of results) expect([r.statusCode, r.json().error], r.body).toEqual([409, 'slot_taken'])
      // Whatever happened, no slot is held twice and nobody lost their place.
      const open = await rows("SELECT patient_id FROM appointments WHERE status = 'booked' AND doctor_id = $1 AND patient_id IN ($2, $3)", [fx.users.doctor, p.id, q.id])
      expect(open.map((r) => r.patient_id).sort()).toEqual([p.id, q.id].sort())
    }
  })

  it('a day the calendar cannot hold is a field problem, not a server error (booking, reschedule and the day view)', async () => {
    const p = await newPatient()
    const res = await book(body(p.id, { date: '0000-01-01' }))
    expect([res.statusCode, res.json().issues.map((i: { path: string }) => i.path)]).toEqual([400, ['date']])
    const a = await booked(p.id)
    expect((await act(a.id, 'reschedule', rescheduleBody(a, { date: '0000-01-01' }))).statusCode).toBe(400)
    expect((await call(ctx.app, 'GET', '/api/appointments', { cookie: nurse, query: { scope: 'date', date: '0000-01-01' } })).statusCode).toBe(400)
    // An empty date says one clear thing.
    expect((await book(body(p.id, { date: '' }))).json().issues.map((i: { message: string }) => i.message)).toEqual(['Choose a date'])
  })
})
