import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { PatientDetail } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { resetStaffPassword } from '../src/auth/local-reset.ts'
import { API_ROOT } from '../src/config.ts'
import { adminQuery, call, closedPort, createFixture, createTestApp, login, resetDatabase, samplePatient, TEST_PASSWORD, testConfig } from './helpers.ts'

const ctx = createTestApp()
afterAll(() => ctx.close())
beforeEach(async () => {
  await resetDatabase()
  await createFixture(ctx.db)
})

const operator = { osUser: 'tester', host: 'test-host', reason: null, breakGlass: false }
const tryLogin = (username: string, password: string) => call(ctx.app, 'POST', '/api/auth/login', { body: { username, password } })

describe('local staff password reset (command line)', () => {
  it('temporary mode: clears a lockout, ends sessions, forces a new password, and is audited with the operator but not the password', async () => {
    const nurse = await login(ctx.app, 't.nurse')
    const p = PatientDetail.parse((await call(ctx.app, 'POST', '/api/patients', { cookie: nurse, body: samplePatient() })).json())
    const oldSession = await login(ctx.app, 't.admin')
    await adminQuery("UPDATE users SET locked_until = now() + interval '10 minutes' WHERE username = 't.admin'")
    expect((await tryLogin('t.admin', TEST_PASSWORD)).statusCode).toBe(423)
    const before = (await adminQuery('SELECT count(*)::int AS n FROM patients')).rows[0].n

    const r = await resetStaffPassword(ctx.db, 'T.Admin', { kind: 'temporary' }, operator)
    expect(r).toMatchObject({ username: 't.admin', role: 'admin', mustChangePassword: true })
    expect(r.temporaryPassword).toMatch(/^[A-HJ-NP-Za-km-z2-9]{16}$/)

    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: oldSession })).statusCode).toBe(401)
    expect((await tryLogin('t.admin', TEST_PASSWORD)).statusCode).toBe(401)
    const ok = await tryLogin('t.admin', r.temporaryPassword!)
    expect(ok.statusCode).toBe(200)
    expect(ok.json().mustChangePassword).toBe(true)

    const audit = (await adminQuery("SELECT actor_role, details FROM audit_events WHERE action = 'user.password_reset'")).rows
    expect(audit).toEqual([{ actor_role: 'local-cli', details: { username: 't.admin', mode: 'temporary', via: 'command line', operator: 'tester', host: 'test-host', reason: null, breakGlass: false } }])
    expect(JSON.stringify(audit)).not.toContain(r.temporaryPassword!)
    // Patient data untouched.
    expect((await adminQuery('SELECT count(*)::int AS n FROM patients')).rows[0].n).toBe(before)
    expect((await call(ctx.app, 'GET', `/api/patients/${p.id}`, { cookie: nurse })).statusCode).toBe(200)
  })

  it('seed-password mode sets the given demo password without forcing a change', async () => {
    const r = await resetStaffPassword(ctx.db, 't.doctor', { kind: 'seed-password', seedPassword: 'Local-demo-password-9' }, operator)
    expect(r).toMatchObject({ temporaryPassword: null, mustChangePassword: false })
    const ok = await tryLogin('t.doctor', 'Local-demo-password-9')
    expect(ok.statusCode).toBe(200)
    expect(ok.json().mustChangePassword).toBe(false)
    await expect(resetStaffPassword(ctx.db, 't.doctor', { kind: 'seed-password', seedPassword: '' }, operator)).rejects.toThrow(/SEED_DEMO_PASSWORD/)
  })

  it('refuses unknown users, patient accounts and deactivated accounts', async () => {
    await expect(resetStaffPassword(ctx.db, 'nobody', { kind: 'temporary' }, operator)).rejects.toThrow(/No user named/)
    await adminQuery("UPDATE users SET role = 'patient' WHERE username = 't.doctor2'")
    await expect(resetStaffPassword(ctx.db, 't.doctor2', { kind: 'temporary' }, operator)).rejects.toThrow(/Patient accounts/)
    await adminQuery("UPDATE users SET is_active = false WHERE username = 't.nurse'")
    await expect(resetStaffPassword(ctx.db, 't.nurse', { kind: 'temporary' }, operator)).rejects.toThrow(/deactivated/)
    expect((await adminQuery("SELECT count(*)::int AS n FROM audit_events WHERE action = 'user.password_reset'")).rows[0].n).toBe(0)
  })

  it('the command refuses demo resets and unexplained resets on production or clinical installations, before any database access', async () => {
    // The child process is pointed at a port where nothing listens, so a guard that
    // regressed could only fail, never touch a real database.
    const port = String(await closedPort())
    const run = (args: string[], env: Record<string, string>) =>
      spawnSync(process.execPath, ['--import', 'tsx', path.join(API_ROOT, 'src', 'reset-password-cli.ts'), ...args], {
        env: { ...process.env, DB_PORT: port, DB_NAME: testConfig.db.name, ...env },
        cwd: API_ROOT,
        encoding: 'utf8',
      })
    // A production installation states its data origin (the configuration refuses to load without it), so "production" is tried with each value.
    const protectedEnvs: Record<string, string>[] = [{ NODE_ENV: 'production', DATA_ORIGIN: 'synthetic' }, { NODE_ENV: 'production', DATA_ORIGIN: 'clinical' }, { DATA_ORIGIN: 'clinical' }]
    for (const env of protectedEnvs) {
      const seed = run(['admin', '--seed-password'], env)
      expect([seed.status, seed.stderr]).toEqual([2, expect.stringContaining('only for local demo installations')])
      const plain = run(['admin'], env)
      expect([plain.status, plain.stderr]).toEqual([2, expect.stringContaining('--break-glass --reason')])
      const noReason = run(['admin', '--break-glass'], env)
      expect(noReason.status).toBe(2)
    }
    // With --break-glass and a reason it gets past the guard and fails only at the (closed) database.
    const glass = run(['admin', '--break-glass', '--reason', 'locked out'], { NODE_ENV: 'production', DATA_ORIGIN: 'clinical' })
    expect(glass.status).toBe(1)
    expect(glass.stderr).toMatch(/\[reset\] ERROR/)
  })
})
