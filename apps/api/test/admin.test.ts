import { AuditPage, UserSummary } from '@adaxai/contracts'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { adminQuery, call, createFixture, createTestApp, type Fixture, login, resetDatabase } from './helpers.ts'

const ctx = createTestApp()
let fx: Fixture
let admin = ''

beforeEach(async () => {
  await resetDatabase()
  fx = await createFixture(ctx.db)
  admin = await login(ctx.app, 't.admin')
})
afterAll(() => ctx.close())

describe('authorization matrix (server-side)', () => {
  const adminOnly: [string, string][] = [
    ['GET', '/api/admin/users'],
    ['GET', '/api/admin/audit-events'],
    ['GET', '/api/admin/overview'],
    ['GET', '/api/system/status'],
  ]

  it.each(['t.doctor', 't.nurse'])('%s is denied admin endpoints, and each denial is audited', async (username) => {
    const cookie = await login(ctx.app, username)
    for (const [method, url] of adminOnly) {
      const res = await call(ctx.app, method as 'GET', url, { cookie })
      expect(res.statusCode, `${method} ${url}`).toBe(403)
    }
    const denied = await adminQuery("SELECT details->>'route' AS route FROM audit_events WHERE action = 'access.denied' ORDER BY id")
    expect(denied.rows.map((r) => r.route)).toEqual(adminOnly.map(([, u]) => u))
  })

  it('admin, doctor and nurse can read departments; anonymous cannot', async () => {
    for (const u of ['t.admin', 't.doctor', 't.nurse']) {
      expect((await call(ctx.app, 'GET', '/api/departments', { cookie: await login(ctx.app, u) })).statusCode).toBe(200)
    }
    expect((await call(ctx.app, 'GET', '/api/departments')).statusCode).toBe(401)
  })

  it('a doctor cannot create users even with a well-formed request', async () => {
    const cookie = await login(ctx.app, 't.doctor')
    const res = await call(ctx.app, 'POST', '/api/admin/users', {
      cookie,
      body: { username: 'sneaky', fullName: 'Sneaky', role: 'admin', temporaryPassword: 'Temporary-pass-1' },
    })
    expect(res.statusCode).toBe(403)
    expect((await adminQuery("SELECT count(*)::int AS n FROM users WHERE username = 'sneaky'")).rows[0].n).toBe(0)
  })
})

describe('user management', () => {
  it('creates a staff user with a hashed temporary password that must be changed', async () => {
    const res = await call(ctx.app, 'POST', '/api/admin/users', {
      cookie: admin,
      body: { username: 'dr.new', fullName: 'Dr New', role: 'doctor', departmentId: fx.departments.gen, registrationNumber: 'REG-9', temporaryPassword: 'Temporary-pass-1' },
    })
    expect(res.statusCode).toBe(201)
    const u = UserSummary.parse(res.json())
    expect(u).toMatchObject({ username: 'dr.new', role: 'doctor', mustChangePassword: true, departmentName: 'General Medicine', registrationNumber: 'REG-9' })
    const { rows } = await adminQuery("SELECT password_hash FROM users WHERE username = 'dr.new'")
    expect(rows[0].password_hash).toMatch(/^\$argon2id\$/)
    const cookie = await login(ctx.app, 'dr.new', 'Temporary-pass-1')
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie })).json().mustChangePassword).toBe(true)
    expect((await adminQuery("SELECT details FROM audit_events WHERE action = 'user.create'")).rows[0].details).toEqual({ username: 'dr.new', role: 'doctor' })
  })

  it('rejects duplicate usernames (case-insensitive), patients-by-admin and invalid input', async () => {
    const dup = await call(ctx.app, 'POST', '/api/admin/users', { cookie: admin, body: { username: 'T.DOCTOR', fullName: 'X', role: 'doctor', temporaryPassword: 'Temporary-pass-1' } })
    expect(dup.statusCode).toBe(409)
    const patient = await call(ctx.app, 'POST', '/api/admin/users', { cookie: admin, body: { username: 'pat', fullName: 'X', role: 'patient', temporaryPassword: 'Temporary-pass-1' } })
    expect(patient.statusCode).toBe(400)
    const bad = await call(ctx.app, 'POST', '/api/admin/users', { cookie: admin, body: { username: 'a b', fullName: '', role: 'doctor', temporaryPassword: 'short' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().issues.map((i: { path: string }) => i.path).sort()).toEqual(['fullName', 'temporaryPassword', 'username'])
  })

  it('deactivating a user ends their sessions immediately', async () => {
    const nurse = await login(ctx.app, 't.nurse')
    const res = await call(ctx.app, 'PATCH', `/api/admin/users/${fx.users.nurse}`, { cookie: admin, body: { isActive: false } })
    expect(res.statusCode).toBe(200)
    expect(res.json().isActive).toBe(false)
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: nurse })).statusCode).toBe(401)
  })

  it('changing a role ends sessions so the new permissions apply at once', async () => {
    const doc = await login(ctx.app, 't.doctor')
    await call(ctx.app, 'PATCH', `/api/admin/users/${fx.users.doctor}`, { cookie: admin, body: { role: 'nurse' } })
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: doc })).statusCode).toBe(401)
  })

  it('an admin cannot deactivate or demote themselves (so at least one admin always remains)', async () => {
    const deactivate = await call(ctx.app, 'PATCH', `/api/admin/users/${fx.users.admin}`, { cookie: admin, body: { isActive: false } })
    expect(deactivate.statusCode).toBe(409)
    expect(deactivate.json().error).toBe('cannot_modify_self')
    const demote = await call(ctx.app, 'PATCH', `/api/admin/users/${fx.users.admin}`, { cookie: admin, body: { role: 'nurse' } })
    expect(demote.statusCode).toBe(409)
    // Editing one's own name is fine.
    expect((await call(ctx.app, 'PATCH', `/api/admin/users/${fx.users.admin}`, { cookie: admin, body: { fullName: 'Renamed Admin' } })).statusCode).toBe(200)
  })

  it('returns 404 for unknown users and 400 for malformed ids', async () => {
    expect((await call(ctx.app, 'PATCH', '/api/admin/users/00000000-0000-4000-8000-000000000000', { cookie: admin, body: { fullName: 'X' } })).statusCode).toBe(404)
    expect((await call(ctx.app, 'PATCH', '/api/admin/users/not-a-uuid', { cookie: admin, body: { fullName: 'X' } })).statusCode).toBe(400)
  })

  it('resets a password: temporary, forced change, unlocks, ends sessions', async () => {
    const nurse = await login(ctx.app, 't.nurse')
    await adminQuery("UPDATE users SET locked_until = now() + interval '10 minutes' WHERE id = $1", [fx.users.nurse])
    const res = await call(ctx.app, 'POST', `/api/admin/users/${fx.users.nurse}/reset-password`, { cookie: admin, body: { temporaryPassword: 'Reset-password-77' } })
    expect(res.statusCode).toBe(200)
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: nurse })).statusCode).toBe(401)
    const again = await login(ctx.app, 't.nurse', 'Reset-password-77')
    expect((await call(ctx.app, 'GET', '/api/auth/me', { cookie: again })).json().mustChangePassword).toBe(true)
  })
})

describe('departments', () => {
  it('creates, renames and rejects duplicate codes', async () => {
    const created = await call(ctx.app, 'POST', '/api/admin/departments', { cookie: admin, body: { code: 'ent', name: 'ENT' } })
    expect(created.statusCode).toBe(201)
    expect(created.json()).toMatchObject({ code: 'ENT', name: 'ENT', isActive: true })
    expect((await call(ctx.app, 'POST', '/api/admin/departments', { cookie: admin, body: { code: 'ENT', name: 'Dup' } })).statusCode).toBe(409)
    const renamed = await call(ctx.app, 'PATCH', `/api/admin/departments/${created.json().id}`, { cookie: admin, body: { name: 'Ear, Nose and Throat', isActive: false } })
    expect(renamed.json()).toMatchObject({ name: 'Ear, Nose and Throat', isActive: false })
  })
})

describe('audit log viewer', () => {
  it('lists events newest first with filters and keyset pagination', async () => {
    await login(ctx.app, 't.doctor')
    await call(ctx.app, 'POST', '/api/auth/login', { body: { username: 't.doctor', password: 'wrong-wrong-1' } })
    const all = AuditPage.parse((await call(ctx.app, 'GET', '/api/admin/audit-events', { cookie: admin })).json())
    expect(all.events.length).toBeGreaterThanOrEqual(3)
    expect(all.events[0]!.id).toBeGreaterThan(all.events.at(-1)!.id)

    const failures = AuditPage.parse((await call(ctx.app, 'GET', '/api/admin/audit-events', { cookie: admin, query: { action: 'auth.login', outcome: 'failure' } })).json())
    expect(failures.events).toHaveLength(1)
    expect(failures.events[0]).toMatchObject({ action: 'auth.login', outcome: 'failure', actorUsername: 't.doctor' })

    const page1 = AuditPage.parse((await call(ctx.app, 'GET', '/api/admin/audit-events', { cookie: admin, query: { limit: '2' } })).json())
    expect(page1.events).toHaveLength(2)
    expect(page1.nextBefore).not.toBeNull()
    const page2 = AuditPage.parse((await call(ctx.app, 'GET', '/api/admin/audit-events', { cookie: admin, query: { limit: '2', before: String(page1.nextBefore) } })).json())
    expect(page2.events[0]!.id).toBeLessThan(page1.events[1]!.id)
  })
})

describe('overview', () => {
  it('returns counts only', async () => {
    const res = await call(ctx.app, 'GET', '/api/admin/overview', { cookie: admin })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ users: { admin: { active: 1 }, doctor: { active: 2 }, nurse: { active: 1 } }, activeDepartments: 2 })
  })
})
