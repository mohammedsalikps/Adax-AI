import { PatientHistory } from '@adaxai/contracts'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedHospital, type SeedResult } from '../src/db/hospital-seed.ts'
import { PATIENTS } from '../src/db/hospital-seed-data.ts'
import { seed } from '../src/db/seed.ts'
import { adminQuery, call, createTestApp, login, resetDatabase, TEST_PASSWORD, testConfig } from './helpers.ts'

// The synthetic hospital dataset (slice V1): that it is what it says it is, internally consistent, idempotent,
// and made through the real API, so its signed records verify and its history reads back through the same read model.

const ctx = createTestApp()
let doctor = ''
let first: SeedResult

beforeAll(async () => {
  await resetDatabase()
  await seed(ctx.db, TEST_PASSWORD)
  first = await seedHospital({ config: testConfig, password: TEST_PASSWORD, log: () => undefined })
  doctor = await login(ctx.app, 'dr.meera')
}, 120_000)
afterAll(() => ctx.close())

const patients = async () => (await call(ctx.app, 'GET', '/api/patients', { cookie: doctor, query: { limit: '50' } })).json().patients as { id: string; fullName: string; dataOrigin: string }[]

describe('the synthetic hospital dataset', () => {
  it('creates the staff, the patients and today’s activity, all marked synthetic', async () => {
    expect(first).toEqual({ created: PATIENTS.length, completed: 0, activity: PATIENTS.length, newStaff: 2 })
    const list = await patients()
    expect(list).toHaveLength(PATIENTS.length)
    expect(new Set(list.map((p) => p.dataOrigin))).toEqual(new Set(['synthetic']))
    // Every history entry says where it comes from.
    const origins = await adminQuery("SELECT 'condition' AS t, data_origin FROM patient_conditions UNION ALL SELECT 'medication', data_origin FROM patient_medications UNION ALL SELECT 'investigation', data_origin FROM investigation_results")
    expect(origins.rows.length).toBeGreaterThan(30)
    expect(origins.rows.every((r) => r.data_origin === 'synthetic')).toBe(true)
    expect((await adminQuery("SELECT username FROM users WHERE username IN ('dr.arjun', 'nurse.divya') ORDER BY 1")).rows.map((r) => r.username)).toEqual(['dr.arjun', 'nurse.divya'])
  })

  it('puts today’s queue and schedule into every state', async () => {
    const queue = (await call(ctx.app, 'GET', '/api/visits', { cookie: doctor })).json().visits as { status: string }[]
    expect([...new Set(queue.map((q) => q.status))].sort()).toEqual(['completed', 'in_consultation', 'in_triage', 'ready', 'waiting'])
    const appts = (await call(ctx.app, 'GET', '/api/appointments', { cookie: doctor, query: { scope: 'today' } })).json().items as { status: string }[]
    expect([...new Set(appts.map((a) => a.status))].sort()).toEqual(['booked', 'checked_in', 'completed', 'no_show'])
    expect(appts).toHaveLength(PATIENTS.filter((p) => p.today?.atOffsetMin !== undefined).length)
  })

  it('reads back a patient’s whole history through the history read model', async () => {
    const ali = (await patients()).find((p) => p.fullName === 'Mohammed Ali')!
    const h = PatientHistory.parse((await call(ctx.app, 'GET', `/api/patients/${ali.id}/history`, { cookie: doctor })).json())
    const spec = PATIENTS.find((p) => p.key === 'mohammed')!
    expect(h.allergies.map((a) => [a.substance, a.severity])).toEqual([['Penicillin', 'severe']])
    expect(h.conditions.map((c) => c.name).sort()).toEqual(spec.conditions.map((c) => c.name).sort())
    expect(h.medications.filter((m) => m.status === 'current').map((m) => m.drugName).sort()).toEqual(['Amlodipine', 'Atorvastatin', 'Metformin'])
    expect(h.medications.find((m) => m.drugName === 'Glimepiride')).toMatchObject({ status: 'stopped', statusReason: 'Episodes of low blood sugar' })
    expect(h.investigations.map((i) => `${i.testName}:${i.flag}`)).toContain('HbA1c:high')
    expect(h.consultations).toHaveLength(spec.past.length)
    expect(h.latestVitals.map((v) => v.kind)).toEqual(expect.arrayContaining(['systolic_bp', 'diastolic_bp', 'spo2']))
  })

  it('gives earlier consultations their historical dates, and they still verify as untouched', async () => {
    const ali = (await patients()).find((p) => p.fullName === 'Mohammed Ali')!
    const h = PatientHistory.parse((await call(ctx.app, 'GET', `/api/patients/${ali.id}/history`, { cookie: doctor })).json())
    const today = new Date().toISOString().slice(0, 10)
    expect(h.consultations.every((c) => c.date < today)).toBe(true)
    expect(h.consultations.map((c) => c.date)).toEqual(h.consultations.map((c) => c.date).sort().reverse())
    for (const c of h.consultations) {
      const v = (await call(ctx.app, 'GET', `/api/encounters/${c.encounterId}/verification`, { cookie: doctor })).json()
      expect(v.status, c.date).toBe('valid')
    }
    // The signing time and the visit's date agree (the record's own dates are historical; the audit log shows when the seed ran).
    const rows = (await adminQuery("SELECT v.visit_date::text AS d, (e.signed_snapshot->>'signedAt') AS signed, e.signed_at FROM encounters e JOIN visits v ON v.id = e.visit_id WHERE e.status = 'signed' AND v.visit_date < current_date")).rows
    expect(rows.length).toBeGreaterThan(10)
    for (const r of rows) expect(String(r.signed).slice(0, 10)).toBe(new Date(r.signed_at).toISOString().slice(0, 10))
  })

  it('never makes a patient or a day’s activity twice, and a re-run changes nothing', async () => {
    const before = (await adminQuery('SELECT (SELECT count(*) FROM patients) AS p, (SELECT count(*) FROM visits) AS v, (SELECT count(*) FROM appointments) AS a, (SELECT count(*) FROM patient_conditions) AS c, (SELECT count(*) FROM encounters) AS e')).rows[0]
    const again = await seedHospital({ config: testConfig, password: TEST_PASSWORD, log: () => undefined })
    expect(again).toEqual({ created: 0, completed: 0, activity: 0, newStaff: 0 })
    expect((await adminQuery('SELECT (SELECT count(*) FROM patients) AS p, (SELECT count(*) FROM visits) AS v, (SELECT count(*) FROM appointments) AS a, (SELECT count(*) FROM patient_conditions) AS c, (SELECT count(*) FROM encounters) AS e')).rows[0]).toEqual(before)
  })

  it('has no medicine in a patient’s history that the same patient is allergic to, by name or by drug class', async () => {
    // What each recorded allergy covers: the substance itself and the medicines of its class.
    const CLASS: Record<string, string[]> = {
      penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'cloxacillin', 'flucloxacillin', 'piperacillin', 'co-amoxiclav', 'amoxicillin-clavulanate'],
      'sulfonamide antibiotics': ['sulfa', 'sulfonamide', 'sulfamethoxazole', 'trimethoprim', 'co-trimoxazole', 'cotrimoxazole'],
    }
    for (const spec of PATIENTS) {
      const covered = spec.allergies.flatMap((a) => CLASS[a.substance.toLowerCase()] ?? [a.substance.toLowerCase()])
      const drugs = [...spec.medications.map((m) => m.drugName), ...spec.past.flatMap((c) => c.prescription.map((r) => r.drugName)), ...(spec.today?.prescription ?? []).map((r) => r.drugName)]
      for (const d of drugs) expect(covered.some((s) => d.toLowerCase().includes(s) || s.includes(d.toLowerCase())), `${spec.key}: ${d}`).toBe(false)
    }
    // And the check itself would notice a violation: a penicillin-allergic patient given amoxicillin.
    const covered = CLASS.penicillin!
    expect(covered.some((s) => 'Amoxicillin'.toLowerCase().includes(s))).toBe(true)
    // Every allergy in the dataset is one the check knows how to read (a class entry or a plain substance).
    expect(PATIENTS.flatMap((p) => p.allergies.map((a) => a.substance)).length).toBeGreaterThan(0)
  })

  it('completes a run that stopped half way, instead of failing or doubling what is there', async () => {
    // A patient made by an earlier run that stopped after registration: no consent, allergy, condition, medicine, result or consultation yet.
    const spec = { ...PATIENTS.find((p) => p.key === 'mohammed')!, key: 'resume', givenName: 'Resumable', familyName: 'Seedtest', dateOfBirth: '1971-02-03', phone: '5000199999', today: undefined }
    const nurse = await login(ctx.app, 'nurse.anil')
    const made = await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: { givenName: spec.givenName, familyName: spec.familyName, dateOfBirth: spec.dateOfBirth, sex: spec.sex, phone: spec.phone, city: spec.city, confirmNotDuplicate: true } })
    expect(made.statusCode).toBe(201)
    const id = made.json().id as string
    // And two entries whose second step (a status change, a stop) did not happen before the run stopped.
    const hypertension = (await call(ctx.app, 'POST', `/api/patients/${id}/conditions`, { cookie: doctor, body: { name: 'Hypertension', code: 'I10', sinceYear: 2018, sinceMonth: 6, status: 'active' } })).json()
    const glimepiride = (await call(ctx.app, 'POST', `/api/patients/${id}/medications`, { cookie: doctor, body: { drugName: 'Glimepiride', strength: '1 mg', form: 'Tablet', dose: '1 tablet', route: 'Oral', frequency: 'Once daily', startedOn: '2021-02-01', reason: 'Type 2 diabetes' } })).json()
    const partial = await seedHospital({ config: testConfig, password: TEST_PASSWORD, patients: [spec], log: () => undefined })
    expect(partial).toEqual({ created: 0, completed: 1, activity: 0, newStaff: 0 })
    const finished = PatientHistory.parse((await call(ctx.app, 'GET', `/api/patients/${id}/history`, { cookie: doctor })).json())
    expect(finished.conditions.find((c) => c.id === hypertension.id)?.status).toBe('controlled')
    expect(finished.medications.find((m) => m.id === glimepiride.id)).toMatchObject({ status: 'stopped', stoppedOn: '2022-01-15' })
    const h = PatientHistory.parse((await call(ctx.app, 'GET', `/api/patients/${id}/history`, { cookie: doctor })).json())
    expect(h.consultations).toHaveLength(spec.past.length)
    expect(h.conditions).toHaveLength(spec.conditions.length)
    expect(h.allergies).toHaveLength(spec.allergies.length)
    // Run again: nothing is added a second time.
    expect(await seedHospital({ config: testConfig, password: TEST_PASSWORD, patients: [spec], log: () => undefined })).toEqual({ created: 0, completed: 0, activity: 0, newStaff: 0 })
    expect(PatientHistory.parse((await call(ctx.app, 'GET', `/api/patients/${id}/history`, { cookie: doctor })).json()).consultations).toHaveLength(spec.past.length)
  })

  it('recognises its patients by name and date of birth, not by phone number', async () => {
    const spec = PATIENTS.find((p) => p.key === 'mohammed')!
    const again = await seedHospital({ config: testConfig, password: TEST_PASSWORD, patients: [{ ...spec, phone: '5000188888' }], log: () => undefined })
    expect(again.created).toBe(0)
  })

  it('refuses to run in a deployment that is not synthetic, in production, or beside records marked as clinical', async () => {
    await expect(seedHospital({ config: { ...testConfig, dataOrigin: 'clinical' }, password: TEST_PASSWORD, log: () => undefined })).rejects.toThrow(/synthetic/)
    await expect(seedHospital({ config: { ...testConfig, env: 'production' }, password: TEST_PASSWORD, log: () => undefined })).rejects.toThrow(/production/)
    const who = (await patients())[0]!
    await adminQuery(`UPDATE patients SET data_origin = 'clinical' WHERE id = '${who.id}'`)
    try {
      await expect(seedHospital({ config: testConfig, password: TEST_PASSWORD, log: () => undefined })).rejects.toThrow(/clinical/)
    } finally {
      await adminQuery(`UPDATE patients SET data_origin = 'synthetic' WHERE id = '${who.id}'`)
    }
  })

  it('refuses a facility that is not marked synthetic', async () => {
    await adminQuery("UPDATE facilities SET name = replace(name, ' (synthetic)', '') WHERE code = 'DEMO-OPD-01'")
    try {
      await expect(seedHospital({ config: testConfig, password: TEST_PASSWORD, log: () => undefined })).rejects.toThrow(/synthetic/)
    } finally {
      await adminQuery("UPDATE facilities SET name = name || ' (synthetic)' WHERE code = 'DEMO-OPD-01' AND name NOT LIKE '%(synthetic)'")
    }
  })
})
