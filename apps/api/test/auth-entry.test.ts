import { PatientDetail } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FAILED_LOGINS } from '../src/auth/routes.ts'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, samplePatient, TEST_PASSWORD } from './helpers.ts'

/**
 * The front door (ADR 0011): sign-in may name the application the person is
 * entering by. A file of its own because every test signs in as the same few
 * accounts after the database is reset, and the sign-in limit is per account
 * and minute.
 */
const ctx = createTestApp()
let fx: Fixture

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
})
afterAll(() => ctx.close())

const auditRows = async (action: string) =>
  (await adminQuery('SELECT actor_user_id, outcome, details FROM audit_events WHERE action = $1 ORDER BY id', [action])).rows

describe('the application a person signs in to', () => {
  const signIn = (username: string, application?: string, password = TEST_PASSWORD) => call(ctx.app, 'POST', '/api/auth/login', { body: { username, password, ...(application && { application }) } })
  const sessionCount = async () => (await adminQuery('SELECT count(*)::int AS n FROM sessions')).rows[0]!.n as number

  /** A patient with an active portal account, signed in by MRN. */
  async function patientAccount() {
    const nurse = await login(ctx.app, 't.nurse')
    const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient({ givenName: 'Entry', phone: '9400000001' }) })).json())
    await call(ctx.app, 'POST', `/api/patients/${p.id}/consents`, { cookie: nurse, body: { type: 'portal_access', method: 'verbal' } })
    const code = (await call(ctx.app, 'POST', `/api/patients/${p.id}/portal-activation`, { cookie: nurse })).json().activationCode
    expect((await call(ctx.app, 'POST', '/api/auth/activate', { body: { mrn: p.mrn, activationCode: code, password: 'Patient-passphrase-1' } })).statusCode).toBe(201)
    await adminQuery('DELETE FROM sessions') // the activation signed them in; start from none
    return { mrn: p.mrn, password: 'Patient-passphrase-1' }
  }

  it('admits each role to its own application, and doctors and nurses to the clinical one', async () => {
    const patient = await patientAccount()
    expect((await signIn('t.doctor', 'doctor')).json()).toMatchObject({ role: 'doctor' })
    expect((await signIn('t.nurse', 'doctor')).json()).toMatchObject({ role: 'nurse' })
    expect((await signIn('t.admin', 'admin')).json()).toMatchObject({ role: 'admin' })
    expect((await signIn(patient.mrn, 'patient', patient.password)).json()).toMatchObject({ role: 'patient' })
    // Not naming an application still works (scripts, older clients).
    expect((await signIn('t.doctor')).statusCode).toBe(200)
  })

  it('refuses the right password at the wrong application: no session, no cookie, and a clear answer', async () => {
    const patient = await patientAccount()
    const before = await sessionCount()
    const wrong: [string, string, string?][] = [
      ['t.doctor', 'admin'],
      ['t.doctor', 'patient'],
      ['t.nurse', 'admin'],
      ['t.admin', 'doctor'],
      ['t.admin', 'patient'],
      [patient.mrn, 'doctor', patient.password],
      [patient.mrn, 'admin', patient.password],
    ]
    for (const [username, application, password] of wrong) {
      const res = await signIn(username, application, password)
      expect([res.statusCode, res.json().error], `${username} at ${application}`).toEqual([403, 'wrong_application'])
      expect(res.json().message).toMatch(/cannot sign in to the (Doctor|Patient|Admin) App/)
      expect(res.headers['set-cookie']).toBeUndefined()
    }
    expect(await sessionCount()).toBe(before)
    // Each refusal is audited with the application asked for, and none is a lockout step.
    const refusals = (await auditRows('auth.login')).filter((r) => r.details.reason === 'wrong_application')
    expect(refusals).toHaveLength(wrong.length)
    expect(refusals[0]!.details).toMatchObject({ application: 'admin', username: 't.doctor' })
    // Once each, and attributed: the global handler adds no second, unattributed "access denied" row for it.
    expect(await auditRows('access.denied')).toEqual([])
    expect(refusals.every((r) => r.actor_user_id !== null)).toBe(true)
    for (let i = 0; i < MAX_FAILED_LOGINS + 2; i++) expect((await signIn('t.doctor', 'admin')).statusCode).toBe(403)
    expect((await signIn('t.doctor', 'doctor')).statusCode).toBe(200)
    // A refusal is not a sign-in (no last-sign-in time) and leaves no failed-attempt count behind.
    expect((await adminQuery("SELECT failed_login_count AS n, last_login_at FROM users WHERE username = 't.admin'")).rows[0]).toMatchObject({ n: 0, last_login_at: null })
    // The nurse is clinical staff: the patient door is not hers.
    expect((await signIn('t.nurse', 'patient')).json().error).toBe('wrong_application')
  })

  it('keeps the other checks in front of the door check: a locked account is locked, a withdrawn portal is invalid, wrong passwords still lock at any door', async () => {
    const patient = await patientAccount()
    // Wrong passwords named at the wrong door lock the account exactly as at the right one.
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) expect((await signIn('t.nurse', 'admin', 'definitely-wrong-3')).statusCode).toBe(401)
    expect((await signIn('t.nurse', 'admin')).statusCode).toBe(423)
    expect((await signIn('t.nurse', 'doctor')).statusCode).toBe(423)
    // A patient whose portal consent was withdrawn is refused as invalid credentials at any door, never as "wrong application".
    await adminQuery("SET session_replication_role = replica; UPDATE consents SET status = 'withdrawn', withdrawn_at = now() WHERE type = 'portal_access'")
    for (const app of ['patient', 'doctor', 'admin']) expect((await signIn(patient.mrn, app, patient.password)).statusCode, app).toBe(401)
  })

  it('does not turn the front door into a way to learn which usernames exist or to guess passwords', async () => {
    // A wrong password or an unknown username is the same 401 whatever application is named, and still counts toward the lockout.
    const unknown = await signIn('t.nobody', 'admin')
    const wrongPw = await signIn('t.doctor', 'admin', 'definitely-wrong-1')
    expect([unknown.statusCode, wrongPw.statusCode]).toEqual([401, 401])
    expect(unknown.json()).toMatchObject({ error: 'invalid_credentials' })
    expect(wrongPw.json()).toMatchObject({ error: 'invalid_credentials' })
    expect(unknown.json().message).toBe(wrongPw.json().message)
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await signIn('t.nurse', 'doctor', 'definitely-wrong-2')
    expect((await signIn('t.nurse', 'doctor')).statusCode).toBe(423)
    // An inactive account is refused as invalid credentials at any application.
    await adminQuery('UPDATE users SET is_active = false WHERE id = $1', [fx.users.admin])
    expect((await signIn('t.admin', 'admin')).statusCode).toBe(401)
    expect((await signIn('t.admin', 'doctor')).statusCode).toBe(401)
  })

  it('refuses an application it does not know', async () => {
    const res = await signIn('t.doctor', 'billing')
    expect(res.statusCode).toBe(400)
    expect(res.json().issues.map((i: { path: string }) => i.path)).toEqual(['application'])
  })

  it('the application chosen at sign-in grants nothing: a doctor session is still refused admin data, and an admin session patient data', async () => {
    const doctor = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.doctor', password: TEST_PASSWORD, application: 'doctor' } })
    const doctorCookie = `adaxai_session=${doctor.cookies.find((c) => c.name === 'adaxai_session')!.value}`
    expect((await call(ctx.app, 'GET', '/api/admin/users', { cookie: doctorCookie })).statusCode).toBe(403)
    const admin = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.admin', password: TEST_PASSWORD, application: 'admin' } })
    const adminCookie = `adaxai_session=${admin.cookies.find((c) => c.name === 'adaxai_session')!.value}`
    expect((await call(ctx.app, 'GET', '/api/patients', { cookie: adminCookie })).statusCode).toBe(403)
    expect((await call(ctx.app, 'GET', '/api/portal/appointments', { cookie: doctorCookie })).statusCode).toBe(403)
  })
})
