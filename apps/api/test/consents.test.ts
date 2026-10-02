import { CONSENT_LABELS, CONSENT_VERSIONS, CONSENT_WITHDRAWAL_EFFECTS, CONSENT_WITHDRAWAL_EFFECTS_FOR_PATIENT, Encounter, PatientDetail, Visit } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient } from './helpers.ts'

const ctx = createTestApp()
let fx: Fixture
let nurse = ''
let doctor = ''
let admin = ''
beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
  nurse = await login(ctx.app, 't.nurse')
  doctor = await login(ctx.app, 't.doctor')
  admin = await login(ctx.app, 't.admin')
})
afterAll(() => ctx.close())

let seq = 0
async function registered(consents: string[] = []) {
  seq++
  const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: `Consent${'abcdefghij'[seq % 10]}${seq}`, phone: `98401 ${String(10000 + seq).slice(-5)}` }) })).json())
  for (const type of consents) expect((await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type, method: 'verbal' } })).statusCode).toBe(201)
  return p
}
const detail = async (id: string) => PatientDetail.parse((await call(ctx.app, 'GET', `/api/patients/${id}`, { cookie: nurse })).json())
const stateOf = async (id: string, type: string) => (await detail(id)).consentStates.find((s) => s.type === type)!
const activeId = async (id: string, type: string) => (await stateOf(id, type)).consentId!

/** A patient with a portal account (activated) and a signed-in patient session. */
async function portalPatient() {
  const p = await registered(['portal_access', 'research_use'])
  const code = (await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })).json().activationCode as string
  const res = await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: code, password: 'Patient-passphrase-1' } })
  expect(res.statusCode).toBe(201)
  return { p, cookie: `adaxai_session=${res.cookies.find((c) => c.name === 'adaxai_session')!.value}` }
}

async function openConsultation(patientId: string) {
  const v = Visit.parse((await call(ctx.app, 'POST', '/api/visits', { cookie: nurse, body: { patientId, departmentId: fx.departments.gen } })).json())
  return Encounter.parse((await call(ctx.app, 'POST', `/api/visits/${v.id}/encounter`, { cookie: doctor })).json())
}

describe('consent lifecycle', () => {
  it('grants with the current wording, renews an earlier wording, and withdraws with reason, actor and channel', async () => {
    const p = await registered(['ai_recording'])
    expect(await stateOf(p.id, 'ai_recording')).toMatchObject({ state: 'granted' })
    expect((await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'ai_recording', method: 'verbal' } })).json().error).toBe('already_granted')

    // The grant was given under an earlier wording (bypassing the guard as the test superuser).
    const first = await activeId(p.id, 'ai_recording')
    await adminQuery(`SET session_replication_role = replica; UPDATE consents SET version = '2026-10-v1' WHERE id = '${first}';`)
    expect(await stateOf(p.id, 'ai_recording')).toMatchObject({ state: 'outdated', consentId: first })

    // Renewal: the earlier grant is superseded by the new one, in one step.
    expect((await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'ai_recording', method: 'written' } })).statusCode).toBe(201)
    const renewed = await detail(p.id)
    const second = renewed.consentStates.find((s) => s.type === 'ai_recording')!.consentId!
    expect(renewed.consents.find((c) => c.id === first)).toMatchObject({ status: 'superseded', supersededBy: second, currentWording: false })
    expect(renewed.consents.find((c) => c.id === second)).toMatchObject({ status: 'granted', version: CONSENT_VERSIONS.ai_recording, currentWording: true })

    // A consultation-only grant as well; withdrawal ends every active grant of the purpose.
    const e = await openConsultation(p.id)
    await adminQuery(`INSERT INTO consents (patient_id, type, method, scope, encounter_id, version) VALUES ('${p.id}', 'ai_recording', 'verbal', 'encounter', '${e.id}', '${CONSENT_VERSIONS.ai_recording}')`)
    const res = await call(ctx.app, 'POST', `/api/patients/${p.id}/consents/${second}/withdraw`, { cookie: nurse, body: { reason: 'Does not want recordings' } })
    expect(res.statusCode).toBe(200)
    const after = PatientDetail.parse(res.json())
    expect(after.consents.filter((c) => c.type === 'ai_recording' && c.status === 'granted')).toEqual([])
    expect(after.consents.find((c) => c.id === second)).toMatchObject({ status: 'withdrawn', withdrawReason: 'Does not want recordings', withdrawnVia: 'staff', withdrawnByName: 'Test t.nurse' })
    expect(after.consentStates.find((s) => s.type === 'ai_recording')).toMatchObject({ state: 'withdrawn', consentId: null })

    const { rows } = await adminQuery("SELECT action, details FROM audit_events WHERE action LIKE 'consent.%' ORDER BY id")
    expect(rows.map((r) => r.action)).toEqual(['consent.grant', 'consent.renew', 'consent.withdraw'])
    expect(rows[1].details).toMatchObject({ supersedes: first, previousVersion: '2026-10-v1' })
    expect(rows[2].details).toMatchObject({ type: 'ai_recording', via: 'staff', reasonGiven: true })
    expect(rows[2].details.withdrawn).toHaveLength(2)
    // The reason stays on the consent record; it is not copied into the audit log.
    expect(JSON.stringify(rows)).not.toContain('Does not want recordings')
  })

  it('consent records cannot be deleted, rewritten or re-granted in place, and only one ongoing grant per purpose is active', async () => {
    const p = await registered(['research_use'])
    const id = await activeId(p.id, 'research_use')
    await expect(adminQuery(`DELETE FROM consents WHERE id = '${id}'`)).rejects.toThrow(/can only be ended once/)
    await expect(adminQuery(`UPDATE consents SET method = 'written' WHERE id = '${id}'`)).rejects.toThrow(/can only be ended once/)
    await expect(adminQuery(`INSERT INTO consents (patient_id, type, method) VALUES ('${p.id}', 'research_use', 'verbal')`)).rejects.toThrow(/consents_one_active_ongoing_uq/)
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents/${id}/withdraw`, { cookie: nurse })
    await expect(adminQuery(`UPDATE consents SET status = 'granted', withdrawn_at = null WHERE id = '${id}'`)).rejects.toThrow(/can only be ended once/)
  })
})

describe('withdrawal texts', () => {
  it('every purpose has a staff and a patient text, and none claims more than the system does', () => {
    for (const t of Object.keys(CONSENT_LABELS) as (keyof typeof CONSENT_LABELS)[]) {
      expect(CONSENT_WITHDRAWAL_EFFECTS[t].length).toBeGreaterThan(20)
      expect(CONSENT_WITHDRAWAL_EFFECTS_FOR_PATIENT[t].length).toBeGreaterThan(20)
    }
    // "Care records" consent is recorded but not enforced: the texts must say so, not promise that processing stops.
    expect(CONSENT_WITHDRAWAL_EFFECTS.data_processing).toMatch(/does not stop/)
    expect(CONSENT_WITHDRAWAL_EFFECTS_FOR_PATIENT.data_processing).toMatch(/still kept and used/)
  })
})

describe('consent is enforced at the API', () => {
  it('absent, granted, withdrawn: recording and AI assistance follow the consent, and refusals are audited', async () => {
    const p = await registered()
    const e = await openConsultation(p.id)
    const transcript = () => call(ctx.app, 'POST', `/api/encounters/${e.id}/transcripts`, { cookie: doctor, body: { text: 'Patient: Synthetic test line.' } })
    expect((await transcript()).json().error).toBe('consent_required')
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'ai_recording', method: 'verbal' } })
    expect((await transcript()).statusCode).toBe(201)
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents/${await activeId(p.id, 'ai_recording')}/withdraw`, { cookie: nurse })
    expect((await transcript()).json().error).toBe('consent_withdrawn')
    const { rows } = await adminQuery("SELECT patient_id, outcome, details FROM audit_events WHERE action = 'consent.blocked' ORDER BY id")
    expect(rows.map((r) => [r.patient_id, r.outcome, r.details.state, r.details.type])).toEqual([
      [p.id, 'denied', 'not_recorded', 'ai_recording'],
      [p.id, 'denied', 'withdrawn', 'ai_recording'],
    ])
  })

  it('a consultation-only grant does not hide an earlier withdrawal of the ongoing consent', async () => {
    const p = await registered(['ai_recording'])
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents/${await activeId(p.id, 'ai_recording')}/withdraw`, { cookie: nurse })
    const e1 = await openConsultation(p.id)
    expect((await call(ctx.app, 'POST', `/api/encounters/${e1.id}/ai-consent`, { cookie: doctor, body: { method: 'verbal' } })).statusCode).toBe(201)
    const d = await detail(p.id)
    expect(d.consentStates.find((s) => s.type === 'ai_recording')!.state).toBe('withdrawn')
    // The consultation-only grant applies to that consultation only.
    expect((await call(ctx.app, 'POST', `/api/encounters/${e1.id}/transcripts`, { cookie: doctor, body: { text: 'Patient: line.' } })).statusCode).toBe(201)
    await call(ctx.app, 'POST', `/api/encounters/${e1.id}/sign`, { cookie: doctor, body: { version: 1, attestation: true } })
  })

  it('a renewal under newer wording counts as continuous consent for buffered device readings', async () => {
    const p = await registered(['device_monitoring'])
    const d = (await call(ctx.app, 'POST', '/api/admin/devices', { cookie: admin, body: { kind: 'wearable_band', label: 'Band R', manufacturer: 'Unknown (not tested)', serialNumber: `SN-${crypto.randomUUID().slice(0, 8)}`, integration: 'gateway_api' } })).json()
    const token = (await call(ctx.app, 'POST', `/api/admin/devices/${d.id}/token`, { cookie: admin })).json().token as string
    await call(ctx.app, 'POST', `/api/devices/${d.id}/assignments`, { cookie: nurse, body: { patientId: p.id } })
    await new Promise((r) => setTimeout(r, 50))
    const measured = new Date().toISOString()
    await new Promise((r) => setTimeout(r, 50))
    const first = await activeId(p.id, 'device_monitoring')
    await adminQuery(`SET session_replication_role = replica; UPDATE consents SET version = '2026-09-v0' WHERE id = '${first}';`)
    expect((await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'device_monitoring', method: 'verbal' } })).statusCode).toBe(201)
    const res = await ctx.app.inject({ method: 'POST', url: '/api/device-ingest/readings', headers: { 'x-adaxai-csrf': '1', authorization: `Bearer ${token}` }, payload: { measuredAt: measured, readings: [{ kind: 'heart_rate', value: 71 }] } })
    expect(res.statusCode).toBe(201)
  })

  it('device readings need consent that was in place when they were measured', async () => {
    const p = await registered(['device_monitoring'])
    const d = (await call(ctx.app, 'POST', '/api/admin/devices', { cookie: admin, body: { kind: 'wearable_band', label: 'Band C', manufacturer: 'Unknown (not tested)', serialNumber: `SN-${crypto.randomUUID().slice(0, 8)}`, integration: 'gateway_api' } })).json()
    const token = (await call(ctx.app, 'POST', `/api/admin/devices/${d.id}/token`, { cookie: admin })).json().token as string
    const ingest = (measuredAt: string) =>
      ctx.app.inject({ method: 'POST', url: '/api/device-ingest/readings', headers: { 'x-adaxai-csrf': '1', authorization: `Bearer ${token}` }, payload: { measuredAt, readings: [{ kind: 'heart_rate', value: 70 }] } })
    expect((await call(ctx.app, 'POST', `/api/devices/${d.id}/assignments`, { cookie: nurse, body: { patientId: p.id } })).statusCode).toBe(201)
    const during = new Date(Date.now() + 1000).toISOString()
    await new Promise((r) => setTimeout(r, 1500))
    // Before the assignment started: refused.
    expect((await ingest(new Date(Date.now() - 3600_000).toISOString())).json().error).toBe('outside_assignment')
    // Withdrawal ends the assignment; consent is given again and the device reassigned.
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents/${await activeId(p.id, 'device_monitoring')}/withdraw`, { cookie: nurse })
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'device_monitoring', method: 'verbal' } })
    expect((await call(ctx.app, 'POST', `/api/devices/${d.id}/assignments`, { cookie: nurse, body: { patientId: p.id } })).statusCode).toBe(201)
    // A buffered reading from the first assignment arrives now: measured before the current consent, refused.
    const late = await ingest(during)
    expect([late.statusCode, late.json().error]).toEqual([409, 'consent_required'])
    expect((await ingest(new Date().toISOString())).statusCode).toBe(201)
    const { rows } = await adminQuery("SELECT details FROM audit_events WHERE action = 'device.ingest' AND outcome = 'denied' ORDER BY id")
    expect(rows.map((r) => r.details.reason)).toEqual(['no_assignment_at_measurement_time', 'measured_before_consent'])
  })

  it('a reading buffered during one patient’s assignment is filed to that patient, not to the next one', async () => {
    const a = await registered(['device_monitoring'])
    const b = await registered(['device_monitoring'])
    const d = (await call(ctx.app, 'POST', '/api/admin/devices', { cookie: admin, body: { kind: 'wearable_band', label: 'Band D', manufacturer: 'Unknown (not tested)', serialNumber: `SN-${crypto.randomUUID().slice(0, 8)}`, integration: 'gateway_api' } })).json()
    const token = (await call(ctx.app, 'POST', `/api/admin/devices/${d.id}/token`, { cookie: admin })).json().token as string
    const first = (await call(ctx.app, 'POST', `/api/devices/${d.id}/assignments`, { cookie: nurse, body: { patientId: a.id } })).json()
    await new Promise((r) => setTimeout(r, 50))
    const measuredForA = new Date().toISOString()
    await new Promise((r) => setTimeout(r, 50))
    await call(ctx.app, 'POST', `/api/device-assignments/${first.assignment.id}/end`, { cookie: nurse, body: { reason: 'Returned' } })
    await call(ctx.app, 'POST', `/api/devices/${d.id}/assignments`, { cookie: nurse, body: { patientId: b.id } })
    const res = await ctx.app.inject({ method: 'POST', url: '/api/device-ingest/readings', headers: { 'x-adaxai-csrf': '1', authorization: `Bearer ${token}` }, payload: { measuredAt: measuredForA, readings: [{ kind: 'heart_rate', value: 66 }] } })
    expect(res.statusCode).toBe(201)
    const { rows } = await adminQuery("SELECT patient_id FROM observations WHERE source = 'device'")
    expect(rows).toEqual([{ patient_id: a.id }])
  })
})

describe('portal consent and portal accounts', () => {
  it('withdrawing portal consent ends access at once; a reset code after new consent restores it', async () => {
    const { p, cookie } = await portalPatient()
    expect((await call(ctx.app, 'GET', '/api/portal/home', { cookie })).statusCode).toBe(200)
    const pending = (await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })).json().activationCode as string

    const res = await call(ctx.app, 'POST', `/api/patients/${p.id}/consents/${await activeId(p.id, 'portal_access')}/withdraw`, { cookie: nurse, body: { reason: 'Relative knows the password' } })
    expect(PatientDetail.parse(res.json()).portalAccount).toMatchObject({ state: 'deactivated', active: false, activationPending: false })
    expect((await call(ctx.app, 'GET', '/api/portal/home', { cookie })).statusCode).toBe(401)
    expect((await call(ctx.app, 'POST', '/api/auth/login', { body: { username: p.mrn, password: 'Patient-passphrase-1' } })).statusCode).toBe(401)
    expect((await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: pending, password: 'Other-passphrase-2' } })).statusCode).toBe(400)
    expect((await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })).json().error).toBe('consent_withdrawn')
    const { rows: w } = await adminQuery("SELECT details FROM audit_events WHERE action = 'consent.withdraw'")
    expect(w[0].details.effects).toEqual(['portal_account_switched_off', 'activation_codes_revoked'])

    // The patient asks for access again: new consent, reset code, new password.
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'portal_access', method: 'written' } })
    const reset = (await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })).json()
    expect(reset.reset).toBe(true)
    const back = await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: reset.activationCode, password: 'Fresh-passphrase-3' } })
    expect(back.statusCode).toBe(200)
    expect((await detail(p.id)).portalAccount.state).toBe('active')
  })

  it('a portal account without portal consent cannot sign in or read, even if the account is switched on', async () => {
    const { p, cookie } = await portalPatient()
    // Consent ended without the account being switched off (bypassing the API as the test superuser).
    await adminQuery(`SET session_replication_role = replica; UPDATE consents SET status = 'withdrawn', withdrawn_at = now() WHERE patient_id = '${p.id}' AND type = 'portal_access';`)
    const r = await call(ctx.app, 'GET', '/api/portal/records', { cookie })
    expect([r.statusCode, r.json().error]).toEqual([403, 'portal_consent_withdrawn'])
    expect((await call(ctx.app, 'POST', '/api/auth/login', { body: { username: p.mrn, password: 'Patient-passphrase-1' } })).statusCode).toBe(401)
    const { rows } = await adminQuery("SELECT action, details FROM audit_events WHERE outcome IN ('denied', 'failure') AND action IN ('portal.access', 'auth.login') ORDER BY id")
    expect(rows.map((x) => [x.action, x.details.reason])).toEqual([
      ['portal.access', 'portal_consent_withdrawn'],
      ['auth.login', 'portal_consent_withdrawn'],
    ])
    // Audited once where it happened, not again by the general refusal handler.
    expect((await adminQuery("SELECT count(*)::int AS n FROM audit_events WHERE action = 'access.denied'")).rows[0].n).toBe(0)
  })

  it('patients withdraw their own consents in the portal (not anyone else’s); withdrawing portal access signs them out', async () => {
    const { p, cookie } = await portalPatient()
    const other = await registered(['research_use'])
    const consents = (await call(ctx.app, 'GET', '/api/portal/consents', { cookie })).json().consents as { id: string; type: string; withdrawalEffect: string | null; currentWording: boolean }[]
    const research = consents.find((c) => c.type === 'research_use')!
    expect(research).toMatchObject({ currentWording: true, withdrawalEffect: expect.stringMatching(/research datasets/i) })
    expect((await call(ctx.app, 'POST', `/api/portal/consents/${research.id}/withdraw`, { cookie, body: { reason: 'Changed my mind' } })).json()).toMatchObject({ ok: true, signedOut: false })
    expect((await detail(p.id)).consents.find((c) => c.id === research.id)).toMatchObject({ status: 'withdrawn', withdrawnVia: 'patient_portal', withdrawReason: 'Changed my mind' })

    // Another patient's consent: not found, and the attempt is audited.
    const theirs = await activeId(other.id, 'research_use')
    expect((await call(ctx.app, 'POST', `/api/portal/consents/${theirs}/withdraw`, { cookie })).statusCode).toBe(404)
    expect((await detail(other.id)).consentStates.find((s) => s.type === 'research_use')!.state).toBe('granted')

    const portal = consents.find((c) => c.type === 'portal_access')!
    const out = await call(ctx.app, 'POST', `/api/portal/consents/${portal.id}/withdraw`, { cookie })
    expect(out.json()).toMatchObject({ signedOut: true })
    expect((await call(ctx.app, 'GET', '/api/portal/home', { cookie })).statusCode).toBe(401)
    const { rows } = await adminQuery("SELECT outcome, details FROM audit_events WHERE action = 'consent.withdraw' ORDER BY id")
    expect(rows.map((r) => [r.outcome, r.details.via])).toEqual([
      ['success', 'patient_portal'],
      ['denied', 'patient_portal'],
      ['success', 'patient_portal'],
    ])
  })

  it('the portal shows the wording the patient actually agreed to, and says when it is an earlier one', async () => {
    const { p, cookie } = await portalPatient()
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'ai_recording', method: 'verbal' } })
    const id = await activeId(p.id, 'ai_recording')
    await adminQuery(`SET session_replication_role = replica; UPDATE consents SET version = '2026-10-v1' WHERE id = '${id}';`)
    const c = ((await call(ctx.app, 'GET', '/api/portal/consents', { cookie })).json().consents as { id: string; title: string; description: string; currentWording: boolean }[]).find((x) => x.id === id)!
    expect(c).toMatchObject({ currentWording: false, title: 'Consultation recording & AI drafting' })
    expect(c.description).not.toContain('record')
  })

  it('staff switch a portal account off at once', async () => {
    const { p, cookie } = await portalPatient()
    expect(PatientDetail.parse((await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-account/disable`, { cookie: nurse })).json()).portalAccount.state).toBe('deactivated')
    expect((await call(ctx.app, 'GET', '/api/portal/home', { cookie })).statusCode).toBe(401)
    expect((await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-account/disable`, { cookie: doctor })).statusCode).toBe(200)
    expect((await adminQuery("SELECT count(*)::int AS n FROM audit_events WHERE action = 'patient.portal_disable'")).rows[0].n).toBe(2)
  })
})
