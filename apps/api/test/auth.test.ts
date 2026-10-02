import { Me } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_FAILED_LOGINS } from '../src/auth/routes.ts'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase, TEST_PASSWORD } from './helpers.ts'

const ctx = createTestApp()
let fx: Fixture

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
})
afterAll(() => ctx.close())

const auditRows = async (action: string) =>
  (await adminQuery('SELECT actor_user_id, outcome, details FROM audit_events WHERE action = $1 ORDER BY id', [action])).rows

describe('login', () => {
  it('sets an httpOnly SameSite=Lax session cookie and returns the user', async () => {
    const res = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.doctor', password: TEST_PASSWORD } })
    expect(res.statusCode).toBe(200)
    const me = Me.parse(res.json())
    expect(me).toMatchObject({ username: 't.doctor', role: 'doctor', mustChangePassword: false })
    const cookie = res.cookies.find((c) => c.name === 'adaxai_session')!
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' })
    expect(cookie.value.length).toBeGreaterThanOrEqual(40)

    const meRes = await call(ctx.app, 'GET', '/api/auth/me', { cookie: `adaxai_session=${cookie.value}` })
    expect(meRes.json()).toMatchObject({ id: fx.users.doctor })
    expect((await auditRows('auth.login'))[0]).toMatchObject({ actor_user_id: fx.users.doctor, outcome: 'success' })
  })

  it('is case-insensitive for the username', async () => {
    expect((await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'T.Doctor', password: TEST_PASSWORD } })).statusCode).toBe(200)
  })

  it('stores only a hash of the session token', async () => {
    const cookie = await login(ctx.app, 't.nurse')
    const token = cookie.split('=')[1]!
    const { rows } = await adminQuery('SELECT token_hash FROM sessions')
    expect(rows).toHaveLength(1)
    expect(rows[0].token_hash).not.toBe(token)
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('gives the same answer for a wrong password and an unknown user, and audits both', async () => {
    const wrong = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.doctor', password: 'nope-nope-nope' } })
    const unknown = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 'nobody', password: 'nope-nope-nope' } })
    expect(wrong.statusCode).toBe(401)
    expect(unknown.statusCode).toBe(401)
    expect(wrong.json().message).toBe(unknown.json().message)
    const rows = await auditRows('auth.login')
    expect(rows.map((r) => [r.outcome, r.details.reason])).toEqual([
      ['failure', 'bad_password'],
      ['failure', 'unknown_user'],
    ])
    // The password itself is never logged.
    expect(JSON.stringify(rows)).not.toContain('nope-nope-nope')
  })

  it(`locks the account after ${MAX_FAILED_LOGINS} failed attempts, even for the right password`, async () => {
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      expect((await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.nurse', password: 'wrong-password-x' } })).statusCode).toBe(401)
    }
    const locked = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.nurse', password: TEST_PASSWORD } })
    expect(locked.statusCode).toBe(423)
    expect(locked.json().error).toBe('account_locked')
    // Lock expires.
    await adminQuery("UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1", [fx.users.nurse])
    expect((await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.nurse', password: TEST_PASSWORD } })).statusCode).toBe(200)
  })

  it('rejects inactive users', async () => {
    await adminQuery('UPDATE users SET is_active = false WHERE id = $1', [fx.users.nurse])
    expect((await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.nurse', password: TEST_PASSWORD } })).statusCode).toBe(401)
  })

  it('validates input', async () => {
    const res = await call(ctx.app, 'POST', '/api/auth/login', { body: { username: '' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues.map((i: { path: string }) => i.path).sort()).toEqual(['password', 'username'])
  })
})

describe('sessions', () => {
  it('protected routes need a session', async () => {
    expect((await call(ctx.app, 'GET', '/api/auth/me')).statusCode).toBe(401)
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: 'adaxai_session=forged-token-value' })).statusCode).toBe(401)
  })

  it('logout ends the session', async () => {
    const cookie = await login(ctx.app, 't.doctor')
    expect((await call(ctx.app, 'POST', '/api/auth/logout', { cookie })).statusCode).toBe(200)
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie })).statusCode).toBe(401)
    expect(await auditRows('auth.logout')).toHaveLength(1)
  })

  it('expired and idle sessions are rejected and removed', async () => {
    const a = await login(ctx.app, 't.doctor')
    await adminQuery("UPDATE sessions SET expires_at = now() - interval '1 second'")
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: a })).statusCode).toBe(401)

    const b = await login(ctx.app, 't.doctor')
    await adminQuery("UPDATE sessions SET last_seen_at = now() - interval '61 minutes'")
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: b })).statusCode).toBe(401)
    expect((await adminQuery('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(0)
  })

  it('state-changing requests without the CSRF header are rejected', async () => {
    const cookie = await login(ctx.app, 't.doctor')
    const res = await call(ctx.app, 'POST', '/api/auth/logout', { cookie, csrf: false })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toBe('csrf_header_missing')
    expect((await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.doctor', password: TEST_PASSWORD }, csrf: false })).statusCode).toBe(403)
  })
})

describe('temporary passwords', () => {
  it('must be changed before anything else is allowed; other sessions end on change', async () => {
    await adminQuery('UPDATE users SET must_change_password = true WHERE id = $1', [fx.users.nurse])
    const first = await login(ctx.app, 't.nurse')
    const second = await login(ctx.app, 't.nurse')
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: first })).json().mustChangePassword).toBe(true)
    const blocked = await call(ctx.app, 'GET', '/api/departments', { cookie: first })
    expect(blocked.statusCode).toBe(403)
    expect(blocked.json().error).toBe('password_change_required')

    const weak = await call(ctx.app, 'POST', '/api/auth/change-password', { cookie: first, body: { currentPassword: TEST_PASSWORD, newPassword: 'short' } })
    expect(weak.statusCode).toBe(400)
    const wrongCurrent = await call(ctx.app, 'POST', '/api/auth/change-password', { cookie: first, body: { currentPassword: 'not-it-at-all', newPassword: 'A-brand-new-passphrase' } })
    expect(wrongCurrent.statusCode).toBe(400)
    const ok = await call(ctx.app, 'POST', '/api/auth/change-password', { cookie: first, body: { currentPassword: TEST_PASSWORD, newPassword: 'A-brand-new-passphrase' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().mustChangePassword).toBe(false)

    expect((await call(ctx.app, 'GET', '/api/departments', { cookie: first })).statusCode).toBe(200)
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: second })).statusCode).toBe(401)
    await login(ctx.app, 't.nurse', 'A-brand-new-passphrase')
  })

  it('rejects a new password containing the username', async () => {
    const cookie = await login(ctx.app, 't.nurse')
    const res = await call(ctx.app, 'POST', '/api/auth/change-password', { cookie, body: { currentPassword: TEST_PASSWORD, newPassword: 'my-t.nurse-password' } })
    expect(res.statusCode).toBe(400)
  })
})
