import { PatientDetail, PatientSummary } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_ACTIVATION_ATTEMPTS } from '../src/auth/activation.ts'
import { hashPassword } from '../src/auth/password.ts'
import { facilities, users } from '../src/db/schema.ts'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient } from './helpers.ts'

const ctx = createTestApp()
let fx: Fixture
let nurse = ''


async function register(body: Record<string, unknown>, cookie = nurse) {
  return call(ctx.app, 'POST', '/api/patients', { cookie, body })
}

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
  nurse = await login(ctx.app, 't.nurse')
})
afterAll(() => ctx.close())

describe('registration', () => {
  it('creates a patient with a generated MRN and a normalised phone number', async () => {
    const res = await register(samplePatient({ abhaNumber: '12-3456-7890-1234', postalCode: '600001' }))
    expect(res.statusCode).toBe(201)
    const p = PatientDetail.parse(res.json())
    expect(p.mrn).toMatch(/^ADX-\d{6}$/)
    expect(p).toMatchObject({ fullName: 'Lakshmi Narayanan', phone: '+919840012345', abhaNumber: '12345678901234', noKnownAllergies: false, portalAccount: { active: false, activationPending: false } })
    const second = PatientDetail.parse((await register(samplePatient({ givenName: 'Arun', phone: '9000000001', dateOfBirth: '1990-01-01' }))).json())
    expect(Number(second.mrn.slice(4))).toBe(Number(p.mrn.slice(4)) + 1)
    const audit = await adminQuery("SELECT patient_id, details FROM audit_events WHERE action = 'patient.create' ORDER BY id")
    expect(audit.rows[0]).toMatchObject({ patient_id: p.id, details: { mrn: p.mrn } })
  })

  it('stores Tamil and Devanagari names unchanged', async () => {
    const p = PatientDetail.parse((await register(samplePatient({ givenName: 'முருகன்', familyName: 'राम' }))).json())
    expect(p.fullName).toBe('முருகன் राम')
  })

  it('validates input on the server', async () => {
    const res = await register({ givenName: '', dateOfBirth: '2999-01-01', sex: 'x', phone: '12', abhaNumber: '123', postalCode: '12', email: 'nope' })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues.map((i: { path: string }) => i.path).sort()).toEqual(['abhaNumber', 'dateOfBirth', 'email', 'givenName', 'phone', 'postalCode', 'sex'])
  })

  it('warns about likely duplicates and allows an explicit override', async () => {
    await register(samplePatient())
    const samePhone = await register(samplePatient({ givenName: 'Someone', familyName: 'Else', dateOfBirth: '2000-01-01' }))
    expect(samePhone.statusCode).toBe(409)
    expect(samePhone.json()).toMatchObject({ error: 'possible_duplicate', candidates: [{ fullName: 'Lakshmi Narayanan' }] })
    const sameNameDob = await register(samplePatient({ phone: '9111111111', givenName: 'LAKSHMI' }))
    expect(sameNameDob.statusCode).toBe(409)
    const overridden = await register(samplePatient({ phone: '9111111111', givenName: 'LAKSHMI', confirmNotDuplicate: true }))
    expect(overridden.statusCode).toBe(201)
    expect((await adminQuery("SELECT details FROM audit_events WHERE action = 'patient.create' ORDER BY id DESC LIMIT 1")).rows[0].details.duplicateWarningOverridden).toBe(true)
  })
})

describe('search', () => {
  beforeEach(async () => {
    await register(samplePatient())
    await register(samplePatient({ givenName: 'Arjun', familyName: 'Mehta', phone: '9876501234', dateOfBirth: '1972-02-02' }))
    await register(samplePatient({ givenName: 'राम', familyName: 'कुमार', phone: '9000000099', dateOfBirth: '1960-06-06' }))
  })
  const search = async (q: string) => (await call(ctx.app, 'GET', '/api/patients', { cookie: nurse, query: { q } })).json().patients.map((p: PatientSummary) => p.fullName)

  it('finds by partial name, case-insensitively, including non-Latin scripts', async () => {
    expect(await search('laksh')).toEqual(['Lakshmi Narayanan'])
    expect(await search('MEHTA')).toEqual(['Arjun Mehta'])
    expect(await search('कुमार')).toEqual(['राम कुमार'])
  })

  it('finds by MRN and by phone digits', async () => {
    const { rows } = await adminQuery("SELECT mrn FROM patients WHERE given_name = 'Arjun'")
    expect(await search(rows[0].mrn.toLowerCase())).toEqual(['Arjun Mehta'])
    expect(await search('76501')).toEqual(['Arjun Mehta'])
  })

  it('audits searches without storing the search text', async () => {
    await search('Lakshmi')
    const { rows } = await adminQuery("SELECT details FROM audit_events WHERE action = 'patient.search'")
    // The audit names the patients the result disclosed, never the search text.
    expect(rows.at(-1).details).toEqual({ queryLength: 7, results: 1, patientIds: [expect.any(String)] })
    expect(JSON.stringify(rows)).not.toContain('Lakshmi')
  })
})

describe('access control', () => {
  it('admins cannot read or create patients', async () => {
    const admin = await login(ctx.app, 't.admin')
    expect((await call(ctx.app, 'GET', '/api/patients', { cookie: admin })).statusCode).toBe(403)
    expect((await register(samplePatient(), admin)).statusCode).toBe(403)
  })

  it('records of another facility are invisible (404, not 403)', async () => {
    const p = PatientDetail.parse((await register(samplePatient())).json())
    const [other] = await ctx.db.insert(facilities).values({ code: 'OTHER', name: 'Other' }).returning()
    await ctx.db.insert(users).values({ facilityId: other!.id, username: 'other.nurse', fullName: 'Other', role: 'nurse', passwordHash: await hashPassword('Other-password-1') })
    const otherNurse = await login(ctx.app, 'other.nurse', 'Other-password-1')
    expect((await call(ctx.app, 'GET', `/api/patients/${p.id}`, { cookie: otherNurse })).statusCode).toBe(404)
    expect((await call(ctx.app, 'GET', '/api/patients', { cookie: otherNurse, query: { q: 'Lakshmi' } })).json().patients).toEqual([])
  })

  it('reading a record is audited with the patient id', async () => {
    const p = PatientDetail.parse((await register(samplePatient())).json())
    const doctor = await login(ctx.app, 't.doctor')
    expect((await call(ctx.app, 'GET', `/api/patients/${p.id}`, { cookie: doctor })).statusCode).toBe(200)
    const { rows } = await adminQuery("SELECT actor_user_id FROM audit_events WHERE action = 'patient.read' AND patient_id = $1", [p.id])
    expect(rows).toEqual([{ actor_user_id: fx.users.doctor }])
  })
})

describe('allergies', () => {
  it('records allergies and keeps "no known allergies" consistent', async () => {
    const p = PatientDetail.parse((await register(samplePatient())).json())
    expect((await call(ctx.app, 'PUT', `/api/patients/${p.id}/no-known-allergies`, { cookie: nurse, body: { noKnownAllergies: true } })).json().noKnownAllergies).toBe(true)
    const withAllergy = PatientDetail.parse((await call(ctx.app, 'POST', `/api/patients/${p.id}/allergies`, { cookie: nurse, body: { substance: 'Penicillin', reaction: 'Rash', severity: 'moderate' } })).json())
    expect(withAllergy.noKnownAllergies).toBe(false)
    expect(withAllergy.allergies[0]).toMatchObject({ substance: 'Penicillin', status: 'active', recordedByName: 'Test t.nurse' })
    const blocked = await call(ctx.app, 'PUT', `/api/patients/${p.id}/no-known-allergies`, { cookie: nurse, body: { noKnownAllergies: true } })
    expect(blocked.statusCode).toBe(409)
    await call(ctx.app, 'POST', `/api/patients/${p.id}/allergies/${withAllergy.allergies[0]!.id}/deactivate`, { cookie: nurse })
    expect((await call(ctx.app, 'PUT', `/api/patients/${p.id}/no-known-allergies`, { cookie: nurse, body: { noKnownAllergies: true } })).statusCode).toBe(200)
  })
})

describe('consents', () => {
  it('grants, refuses a duplicate grant, and keeps withdrawn consents in history', async () => {
    const p = PatientDetail.parse((await register(samplePatient())).json())
    const granted = PatientDetail.parse((await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'ai_recording', method: 'verbal' } })).json())
    expect(granted.consents[0]).toMatchObject({ type: 'ai_recording', status: 'granted', method: 'verbal', version: '2026-10-v2' })
    expect((await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'ai_recording', method: 'written' } })).statusCode).toBe(409)
    const withdrawn = PatientDetail.parse((await call(ctx.app, 'POST', `/api/patients/${p.id}/consents/${granted.consents[0]!.id}/withdraw`, { cookie: nurse })).json())
    expect(withdrawn.consents[0]).toMatchObject({ status: 'withdrawn' })
    expect(withdrawn.consents[0]!.withdrawnAt).not.toBeNull()
    // Can be granted again afterwards; both records remain.
    const again = PatientDetail.parse((await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'ai_recording', method: 'written' } })).json())
    expect(again.consents.map((c) => c.status)).toEqual(['granted', 'withdrawn'])
  })
})

describe('patient portal activation', () => {
  async function patientWithCode() {
    const p = PatientDetail.parse((await register(samplePatient())).json())
    const noConsent = await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })
    expect(noConsent.statusCode).toBe(409)
    expect(noConsent.json().error).toBe('consent_required')
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'portal_access', method: 'verbal' } })
    const issued = await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })
    expect(issued.statusCode).toBe(201)
    return { p, code: issued.json().activationCode as string }
  }

  it('activates with MRN + code, signs the patient in, and the code is single-use', async () => {
    const { p, code } = await patientWithCode()
    expect(code).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/)
    const { rows } = await adminQuery('SELECT code_hash FROM patient_activation_codes')
    expect(rows[0].code_hash).not.toContain(code.replace('-', ''))

    const res = await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn.toLowerCase(), activationCode: code.toLowerCase(), password: 'My-own-passphrase-1' } })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ role: 'patient', patientId: p.id, username: p.mrn })
    const cookie = `adaxai_session=${res.cookies.find((c) => c.name === 'adaxai_session')!.value}`
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie })).json().role).toBe('patient')
    // Patients cannot use staff APIs.
    expect((await call(ctx.app, 'GET', '/api/patients', { cookie })).statusCode).toBe(403)
    expect((await call(ctx.app, 'GET', `/api/patients/${p.id}`, { cookie })).statusCode).toBe(403)

    const reuse = await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: code, password: 'Another-passphrase-2' } })
    expect(reuse.statusCode).toBe(400)
    await login(ctx.app, p.mrn, 'My-own-passphrase-1')
    // A code for an existing account is a reset code (sets a new password, ends old sessions).
    const resetCode = await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })
    expect([resetCode.statusCode, resetCode.json().reset]).toEqual([201, true])
    const reset = await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: resetCode.json().activationCode, password: 'A-new-passphrase-3' } })
    expect(reset.statusCode).toBe(200)
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie })).statusCode).toBe(401)
    await login(ctx.app, p.mrn, 'A-new-passphrase-3')
    const { rows: trail } = await adminQuery("SELECT action, details FROM audit_events WHERE action IN ('patient.portal_activate', 'patient.portal_reset') AND outcome = 'success' ORDER BY id")
    expect(trail.map((r) => r.action)).toEqual(['patient.portal_activate', 'patient.portal_reset'])
    expect(trail[1].details.codeIssuedBy).toEqual(expect.any(String))
  })

  it(`revokes a code after ${MAX_ACTIVATION_ATTEMPTS} wrong attempts`, async () => {
    const { p, code } = await patientWithCode()
    for (let i = 0; i < MAX_ACTIVATION_ATTEMPTS; i++) {
      const r = await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: 'WRONG-CODE1', password: 'My-own-passphrase-1' } })
      expect(r.statusCode).toBe(400)
    }
    const correctButRevoked = await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: code, password: 'My-own-passphrase-1' } })
    expect(correctButRevoked.statusCode).toBe(400)
    expect(correctButRevoked.json().message).toMatch(/not valid/)
  })

  it('issuing a new code revokes the previous one', async () => {
    const { p, code } = await patientWithCode()
    const second = (await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })).json().activationCode
    expect((await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: code, password: 'My-own-passphrase-1' } })).statusCode).toBe(400)
    expect((await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: second, password: 'My-own-passphrase-1' } })).statusCode).toBe(201)
  })
})
