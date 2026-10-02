import {
  AuditQuery,
  CreateUserRequest,
  DepartmentInput,
  DepartmentUpdate,
  ResetPasswordRequest,
  type AuditEvent,
  type Department,
  type UserSummary,
  UpdateUserRequest,
} from '@adaxai/contracts'
import { and, asc, desc, eq, gte, lt, ne, sql, type SQL } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { hashPassword } from '../auth/password.ts'
import { currentUser } from '../auth/plugin.ts'
import { revokeUserSessions } from '../auth/sessions.ts'
import { type Db, pgCode } from '../db/client.ts'
import { auditEvents, departments, sessions, users, visits } from '../db/schema.ts'
import { facilityToday } from '../patients/service.ts'
import { conflict, notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'

const IdParams = z.object({ id: z.uuid() })

const iso = (d: Date | null) => (d ? d.toISOString() : null)

async function listUsers(db: Db, where?: SQL): Promise<UserSummary[]> {
  const rows = await db
    .select({ u: users, departmentName: departments.name })
    .from(users)
    .leftJoin(departments, eq(departments.id, users.departmentId))
    .where(where)
    .orderBy(asc(users.role), asc(users.fullName))
  return rows.map(({ u, departmentName }) => ({
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    role: u.role,
    isActive: u.isActive,
    mustChangePassword: u.mustChangePassword,
    departmentId: u.departmentId,
    departmentName,
    registrationNumber: u.registrationNumber,
    lastLoginAt: iso(u.lastLoginAt),
    lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }))
}

async function assertDepartment(db: Db, facilityId: string, departmentId: string | null | undefined) {
  if (!departmentId) return
  const d = await db.query.departments.findFirst({ where: and(eq(departments.id, departmentId), eq(departments.facilityId, facilityId)) })
  if (!d) throw conflict('Department does not exist', 'invalid_department')
}

const toDepartment = (d: typeof departments.$inferSelect): Department => ({ id: d.id, code: d.code, name: d.name, isActive: d.isActive })

export function registerAdminRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // ---- Users (staff accounts; patient accounts are created by activation) ----

  app.get('/api/admin/users', { config: { permission: 'users:manage' } }, async () => {
    return { users: await listUsers(db, ne(users.role, 'patient')) }
  })

  app.post('/api/admin/users', { config: { permission: 'users:manage' } }, async (req, reply) => {
    const me = currentUser(req)
    const body = parse(CreateUserRequest, req.body)
    await assertDepartment(db, me.facilityId, body.departmentId)
    try {
      const [created] = await db
        .insert(users)
        .values({
          facilityId: me.facilityId,
          username: body.username,
          fullName: body.fullName,
          role: body.role,
          departmentId: body.departmentId ?? null,
          registrationNumber: body.registrationNumber ?? null,
          passwordHash: await hashPassword(body.temporaryPassword),
          mustChangePassword: true,
          createdBy: me.id,
        })
        .returning({ id: users.id })
      await audit(db, req, { action: 'user.create', entityType: 'user', entityId: created!.id, details: { username: body.username, role: body.role } })
      const [summary] = await listUsers(db, eq(users.id, created!.id))
      return reply.code(201).send(summary)
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('That username is already taken', 'username_taken')
      throw e
    }
  })

  app.patch('/api/admin/users/:id', { config: { permission: 'users:manage' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(UpdateUserRequest, req.body)
    const target = await db.query.users.findFirst({ where: eq(users.id, id) })
    if (!target || target.role === 'patient') throw notFound('User')
    if (id === me.id && (body.isActive === false || (body.role && body.role !== target.role))) {
      throw conflict('You cannot deactivate yourself or change your own role', 'cannot_modify_self')
    }
    const losingAdmin = target.role === 'admin' && target.isActive && (body.isActive === false || (body.role && body.role !== 'admin'))
    if (losingAdmin) {
      const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, true)))) as [{ n: number }]
      if (n <= 1) throw conflict('At least one active administrator is required', 'last_admin')
    }
    await assertDepartment(db, me.facilityId, body.departmentId)

    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ ...body, updatedAt: sql`now()` })
        .where(eq(users.id, id))
      // Deactivation or a role change ends existing sessions immediately.
      if (body.isActive === false || (body.role && body.role !== target.role)) await revokeUserSessions(tx, id)
      await audit(tx, req, { action: 'user.update', entityType: 'user', entityId: id, details: { changed: Object.keys(body), ...(body.role && { role: body.role }), ...(body.isActive !== undefined && { isActive: body.isActive }) } })
    })
    const [summary] = await listUsers(db, eq(users.id, id))
    return summary
  })

  app.post('/api/admin/users/:id/reset-password', { config: { permission: 'users:manage' } }, async (req) => {
    const { id } = parse(IdParams, req.params)
    const body = parse(ResetPasswordRequest, req.body)
    const target = await db.query.users.findFirst({ where: eq(users.id, id) })
    if (!target || target.role === 'patient') throw notFound('User')
    const passwordHash = await hashPassword(body.temporaryPassword)
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null, passwordChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(users.id, id))
      await revokeUserSessions(tx, id)
      await audit(tx, req, { action: 'user.password_reset', entityType: 'user', entityId: id })
    })
    return { ok: true }
  })

  // ---- Staff directory (for assigning doctors / departments) ----

  app.get('/api/staff', { config: { permission: 'staff:read' } }, async (req) => {
    const q = parse(z.object({ role: z.enum(['doctor', 'nurse']).optional() }), req.query)
    const rows = await db
      .select({ id: users.id, fullName: users.fullName, role: users.role, departmentId: users.departmentId })
      .from(users)
      .where(and(eq(users.isActive, true), q.role ? eq(users.role, q.role) : sql`${users.role} in ('doctor','nurse')`))
      .orderBy(asc(users.fullName))
    return { staff: rows }
  })

  // ---- Departments ----

  app.get('/api/departments', { config: { permission: 'departments:read' } }, async (req) => {
    const me = currentUser(req)
    const rows = await db.select().from(departments).where(eq(departments.facilityId, me.facilityId)).orderBy(asc(departments.name))
    return { departments: rows.map(toDepartment) }
  })

  app.post('/api/admin/departments', { config: { permission: 'departments:manage' } }, async (req, reply) => {
    const me = currentUser(req)
    const body = parse(DepartmentInput, req.body)
    try {
      const [d] = await db.insert(departments).values({ facilityId: me.facilityId, code: body.code.toUpperCase(), name: body.name, isActive: body.isActive ?? true }).returning()
      await audit(db, req, { action: 'department.create', entityType: 'department', entityId: d!.id, details: { code: d!.code } })
      return reply.code(201).send(toDepartment(d!))
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('A department with that code already exists', 'department_code_taken')
      throw e
    }
  })

  app.patch('/api/admin/departments/:id', { config: { permission: 'departments:manage' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(DepartmentUpdate, req.body)
    try {
      const [d] = await db
        .update(departments)
        .set({ ...body, ...(body.code && { code: body.code.toUpperCase() }), updatedAt: sql`now()` })
        .where(and(eq(departments.id, id), eq(departments.facilityId, me.facilityId)))
        .returning()
      if (!d) throw notFound('Department')
      await audit(db, req, { action: 'department.update', entityType: 'department', entityId: id, details: { changed: Object.keys(body) } })
      return toDepartment(d)
    } catch (e) {
      if (pgCode(e) === '23505') throw conflict('A department with that code already exists', 'department_code_taken')
      throw e
    }
  })

  // ---- Audit log ----

  app.get('/api/admin/audit-events', { config: { permission: 'audit:read' } }, async (req) => {
    const q = parse(AuditQuery, req.query)
    const conds: SQL[] = []
    if (q.action) conds.push(sql`${auditEvents.action} ilike ${`${q.action.replace(/[%_\\]/g, '\\$&')}%`}`)
    if (q.actorUserId) conds.push(eq(auditEvents.actorUserId, q.actorUserId))
    if (q.patientId) conds.push(eq(auditEvents.patientId, q.patientId))
    if (q.outcome) conds.push(eq(auditEvents.outcome, q.outcome))
    if (q.from) conds.push(gte(auditEvents.occurredAt, new Date(`${q.from}T00:00:00Z`)))
    if (q.to) conds.push(lt(auditEvents.occurredAt, new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000)))
    if (q.before) conds.push(lt(auditEvents.id, q.before))
    const rows = await db
      .select({ e: auditEvents, actorUsername: users.username })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditEvents.id))
      .limit(q.limit + 1)
    const page = rows.slice(0, q.limit)
    const events: AuditEvent[] = page.map(({ e, actorUsername }) => ({
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      actorUserId: e.actorUserId,
      actorUsername,
      actorRole: e.actorRole,
      action: e.action,
      outcome: e.outcome,
      entityType: e.entityType,
      entityId: e.entityId,
      patientId: e.patientId,
      ip: e.ip,
      details: (e.details ?? {}) as Record<string, unknown>,
    }))
    await audit(db, req, { action: 'audit.read', details: { filters: Object.keys(req.query ?? {}).filter((k) => k !== 'limit' && k !== 'before') } })
    return { events, nextBefore: rows.length > q.limit ? (page.at(-1)?.e.id ?? null) : null }
  })

  // ---- Operational overview (counts only; no clinical content) ----

  app.get('/api/admin/overview', { config: { permission: 'overview:read' } }, async (req) => {
    const me = currentUser(req)
    const today = await facilityToday(db, me.facilityId)
    const [queue] = await db
      .select({
        total: sql<number>`count(*)::int`,
        waiting: sql<number>`count(*) filter (where ${visits.status} in ('waiting', 'in_triage', 'ready'))::int`,
        withDoctor: sql<number>`count(*) filter (where ${visits.status} = 'in_consultation')::int`,
        completed: sql<number>`count(*) filter (where ${visits.status} = 'completed')::int`,
      })
      .from(visits)
      .where(and(eq(visits.facilityId, me.facilityId), eq(visits.visitDate, today)))
    const roleCounts = await db
      .select({ role: users.role, active: sql<number>`count(*) filter (where ${users.isActive})::int`, total: sql<number>`count(*)::int` })
      .from(users)
      .groupBy(users.role)
    const [sessionCount] = await db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(sql`${sessions.expiresAt} > now()`)
    const [deptCount] = await db.select({ n: sql<number>`count(*)::int` }).from(departments).where(eq(departments.isActive, true))
    const [failedLogins] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'auth.login'), eq(auditEvents.outcome, 'failure'), sql`${auditEvents.occurredAt} > now() - interval '24 hours'`))
    return {
      users: Object.fromEntries(roleCounts.map((r) => [r.role, { active: r.active, total: r.total }])),
      activeSessions: sessionCount?.n ?? 0,
      activeDepartments: deptCount?.n ?? 0,
      failedLogins24h: failedLogins?.n ?? 0,
      queueToday: queue ?? { total: 0, waiting: 0, withDoctor: 0, completed: 0 },
    }
  })
}
