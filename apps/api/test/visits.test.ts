import { PatientDetail, Visit } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient } from './helpers.ts'

const ctx = createTestApp()
let fx: Fixture
let nurse = ''
let doctor = ''

let phoneSeq = 0
async function newPatient(over: Record<string, unknown> = {}) {
  phoneSeq++
  const res = await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: `Pat${phoneSeq}`, phone: `90000${String(phoneSeq).padStart(5, '0')}`, ...over }) })
  return PatientDetail.parse(res.json())
}
async function checkIn(patientId: string, over: Record<string, unknown> = {}) {
  return call(ctx.app, 'POST', '/api/visits', { cookie: nurse, body: { patientId, departmentId: fx.departments.gen, ...over } })
}

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
  nurse = await login(ctx.app, 't.nurse')
  doctor = await login(ctx.app, 't.doctor')
})
afterAll(() => ctx.close())

describe('check-in and tokens', () => {
  it('issues sequential daily tokens', async () => {
    const a = Visit.parse((await checkIn((await newPatient()).id)).json())
    const b = Visit.parse((await checkIn((await newPatient()).id)).json())
    expect([a.tokenNumber, b.tokenNumber]).toEqual([1, 2])
    expect(a).toMatchObject({ status: 'waiting', departmentName: 'General Medicine', encounterId: null })
  })

  it('never issues the same token twice under concurrent check-ins', async () => {
    const patients = await Promise.all(Array.from({ length: 12 }, () => newPatient()))
    const results = await Promise.all(patients.map((p) => checkIn(p.id)))
    const tokens = results.map((r) => r.json().tokenNumber).sort((x: number, y: number) => x - y)
    expect(tokens).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
  })

  it('refuses a second open visit for the same patient on the same day', async () => {
    const p = await newPatient()
    await checkIn(p.id)
    const dup = await checkIn(p.id)
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error).toBe('visit_already_open')
  })

  it('validates department and doctor on the server', async () => {
    const p = await newPatient()
    expect((await checkIn(p.id, { departmentId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(400)
    expect((await checkIn(p.id, { assignedDoctorId: fx.users.nurse })).statusCode).toBe(400)
  })
})

describe('queue views', () => {
  it('lists urgent first, and the doctor view shows assigned plus unassigned in their department', async () => {
    const p1 = await newPatient()
    const p2 = await newPatient()
    const p3 = await newPatient()
    const p4 = await newPatient()
    await checkIn(p1.id)
    await checkIn(p2.id, { priority: 'urgent' })
    await checkIn(p3.id, { departmentId: fx.departments.ped })
    await checkIn(p4.id, { departmentId: fx.departments.ped, assignedDoctorId: fx.users.doctor })
    const all = (await call(ctx.app, 'GET', '/api/visits', { cookie: nurse })).json().visits as Visit[]
    expect(all.map((v) => v.patient.id)).toEqual([p2.id, p1.id, p3.id, p4.id])
    const mine = (await call(ctx.app, 'GET', '/api/visits', { cookie: doctor, query: { mine: 'true' } })).json().visits as Visit[]
    expect(mine.map((v) => v.patient.id).sort()).toEqual([p1.id, p2.id, p4.id].sort())
    const doctor2 = await login(ctx.app, 't.doctor2')
    const mine2 = (await call(ctx.app, 'GET', '/api/visits', { cookie: doctor2, query: { mine: 'true' } })).json().visits as Visit[]
    expect(mine2.map((v) => v.patient.id)).toEqual([p3.id])
  })

  it('admins cannot see the queue', async () => {
    expect((await call(ctx.app, 'GET', '/api/visits', { cookie: await login(ctx.app, 't.admin') })).statusCode).toBe(403)
  })
})

describe('status changes', () => {
  it('follows the allowed transitions and never completes a visit manually', async () => {
    const v = Visit.parse((await checkIn((await newPatient()).id)).json())
    const go = (status: string, reason?: string) => call(ctx.app, 'POST', `/api/visits/${v.id}/status`, { cookie: nurse, body: { status, reason } })
    expect((await go('in_triage')).json().status).toBe('in_triage')
    expect((await go('ready')).json().status).toBe('ready')
    expect((await go('completed')).statusCode).toBe(409)
    expect((await go('in_consultation')).statusCode).toBe(409)
    expect((await go('cancelled')).statusCode).toBe(400)
    expect((await go('cancelled', 'Patient left')).json().status).toBe('cancelled')
    expect((await go('waiting')).statusCode).toBe(409)
    const audit = await adminQuery("SELECT outcome, details FROM audit_events WHERE action = 'visit.status' ORDER BY id")
    expect(audit.rows.filter((r) => r.outcome === 'success').map((r) => `${r.details.from}>${r.details.to}`)).toEqual(['waiting>in_triage', 'in_triage>ready', 'ready>cancelled'])
    // Refused changes leave a trace too (slice 3).
    expect(audit.rows.filter((r) => r.outcome === 'failure').map((r) => `${r.details.from}>${r.details.to}:${r.details.code}`)).toEqual([
      'ready>completed:invalid_transition',
      'ready>in_consultation:invalid_transition',
      'cancelled>waiting:invalid_transition',
    ])
  })

  it('a cancelled visit frees the patient for a new check-in the same day', async () => {
    const p = await newPatient()
    const v = Visit.parse((await checkIn(p.id)).json())
    await call(ctx.app, 'POST', `/api/visits/${v.id}/status`, { cookie: nurse, body: { status: 'cancelled', reason: 'Wrong department' } })
    expect((await checkIn(p.id)).statusCode).toBe(201)
  })
})

describe('vitals', () => {
  it('records vitals, flags against adult ranges and starts intake', async () => {
    const v = Visit.parse((await checkIn((await newPatient({ dateOfBirth: '1980-01-01' })).id)).json())
    const res = await call(ctx.app, 'POST', `/api/visits/${v.id}/observations`, {
      cookie: nurse,
      body: { items: [{ kind: 'temperature', value: 38.6 }, { kind: 'heart_rate', value: 72 }, { kind: 'spo2', value: 88 }, { kind: 'weight', value: 64.5 }] },
    })
    expect(res.statusCode).toBe(201)
    const after = Visit.parse(res.json())
    expect(after.status).toBe('in_triage')
    const byKind = Object.fromEntries(after.latestVitals.map((o) => [o.kind, o]))
    expect(byKind.temperature).toMatchObject({ value: 38.6, unit: '°C', flag: 'high', source: 'manual', validationStatus: 'manual_entry', recordedByName: 'Test t.nurse' })
    expect(byKind.heart_rate!.flag).toBe('normal')
    expect(byKind.spo2!.flag).toBe('critical_low')
    expect(byKind.weight!.flag).toBeNull()
    expect(after.abnormalVitalCount).toBe(2)
  })

  it('does not apply adult flags to children', async () => {
    const child = await newPatient({ dateOfBirth: '2020-05-05' })
    const v = Visit.parse((await checkIn(child.id)).json())
    const after = Visit.parse((await call(ctx.app, 'POST', `/api/visits/${v.id}/observations`, { cookie: nurse, body: { items: [{ kind: 'heart_rate', value: 130 }] } })).json())
    expect(after.latestVitals[0]!.flag).toBeNull()
  })

  it('rejects implausible values and duplicates in one submission', async () => {
    const v = Visit.parse((await checkIn((await newPatient()).id)).json())
    const res = await call(ctx.app, 'POST', `/api/visits/${v.id}/observations`, { cookie: nurse, body: { items: [{ kind: 'temperature', value: 386 }] } })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues[0]).toMatchObject({ path: 'items.0.value' })
    const dup = await call(ctx.app, 'POST', `/api/visits/${v.id}/observations`, { cookie: nurse, body: { items: [{ kind: 'heart_rate', value: 70 }, { kind: 'heart_rate', value: 71 }] } })
    expect(dup.statusCode).toBe(400)
  })

  it('a wrong value is marked entered-in-error, never deleted', async () => {
    const p = await newPatient()
    const v = Visit.parse((await checkIn(p.id)).json())
    const after = Visit.parse((await call(ctx.app, 'POST', `/api/visits/${v.id}/observations`, { cookie: nurse, body: { items: [{ kind: 'weight', value: 640 / 10 }] } })).json())
    const obsId = after.latestVitals[0]!.id
    expect((await call(ctx.app, 'POST', `/api/observations/${obsId}/entered-in-error`, { cookie: nurse, body: { reason: 'Wrong patient' } })).statusCode).toBe(200)
    const list = (await call(ctx.app, 'GET', `/api/patients/${p.id}/observations`, { cookie: doctor })).json().observations
    expect(list).toEqual([])
    const withErrors = (await call(ctx.app, 'GET', `/api/patients/${p.id}/observations`, { cookie: doctor, query: { includeErrors: 'true' } })).json().observations
    expect(withErrors).toHaveLength(1)
    expect(withErrors[0].enteredInError).toBe(true)
    expect((await adminQuery('SELECT count(*)::int AS n FROM observations')).rows[0].n).toBe(1)
  })

  it('vitals cannot be added to a closed visit, and admins cannot record vitals', async () => {
    const v = Visit.parse((await checkIn((await newPatient()).id)).json())
    const admin = await login(ctx.app, 't.admin')
    expect((await call(ctx.app, 'POST', `/api/visits/${v.id}/observations`, { cookie: admin, body: { items: [{ kind: 'heart_rate', value: 70 }] } })).statusCode).toBe(403)
    await call(ctx.app, 'POST', `/api/visits/${v.id}/status`, { cookie: nurse, body: { status: 'no_show' } })
    expect((await call(ctx.app, 'POST', `/api/visits/${v.id}/observations`, { cookie: nurse, body: { items: [{ kind: 'heart_rate', value: 70 }] } })).statusCode).toBe(409)
  })
})
