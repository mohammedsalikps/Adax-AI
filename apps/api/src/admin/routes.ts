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
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { hashPassword } from '../auth/password.ts'
import { currentUser } from '../auth/plugin.ts'
import { revokeUserSessions, type SessionUser } from '../auth/sessions.ts'
import { type Db, pgCode } from '../db/client.ts'
import { auditEvents, departments, patients, sessions, users, visits } from '../db/schema.ts'
import { facilityToday } from '../patients/service.ts'
import { conflict, deniedNotFound, notFound } from '../http/errors.ts'
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

  app.get('/api/admin/users', { config: { permission: 'users:manage' } }, async (req) => {
    const me = currentUser(req)
    return { users: await listUsers(db, and(ne(users.role, 'patient'), eq(users.facilityId, me.facilityId))!) }
  })

  /** A staff account of the caller's facility (another facility's account is "not found"). */
  async function staffOr404(me: SessionUser, id: string) {
    const target = await db.query.users.findFirst({ where: and(eq(users.id, id), eq(users.facilityId, me.facilityId)) })
    if (!target || target.role === 'patient') throw deniedNotFound('User', { entityType: 'user', entityId: id, reason: target ? 'patient_account' : 'not_found_or_other_facility' })
    return target
  }
  const refuse = (req: FastifyRequest, id: string, reason: string) => audit(db, req, { action: 'user.update', outcome: 'denied', entityType: 'user', entityId: id, details: { reason } })

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
    const target = await staffOr404(me, id)
    if (id === me.id && (body.isActive === false || (body.role && body.role !== target.role))) {
      await refuse(req, id, 'cannot_modify_self')
      throw conflict('You cannot deactivate yourself or change your own role', 'cannot_modify_self')
    }
    const losingAdmin = target.role === 'admin' && target.isActive && (body.isActive === false || (body.role && body.role !== 'admin'))
    await assertDepartment(db, me.facilityId, body.departmentId)

    await db.transaction(async (tx) => {
      if (losingAdmin) {
        // Counted per facility, under a lock, so two admins cannot remove each other at the same time.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`last-admin:${me.facilityId}`}))`)
        const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, 'admin'), eq(users.isActive, true), eq(users.facilityId, me.facilityId)))) as [{ n: number }]
        if (n <= 1) {
          await refuse(req, id, 'last_admin')
          throw conflict('At least one active administrator is required', 'last_admin')
        }
      }
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

  /**
   * Temporary password for a staff account of this facility: the user must
   * replace it at the next sign-in, and all their sessions end. (The admin
   * knows the temporary password until then; the reset is audited.)
   */
  app.post('/api/admin/users/:id/reset-password', { config: { permission: 'users:manage' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(ResetPasswordRequest, req.body)
    await staffOr404(me, id)
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
    const me = currentUser(req)
    const q = parse(z.object({ role: z.enum(['doctor', 'nurse']).optional() }), req.query)
    const rows = await db
      .select({ id: users.id, fullName: users.fullName, role: users.role, departmentId: users.departmentId })
      .from(users)
      .where(and(eq(users.isActive, true), eq(users.facilityId, me.facilityId), q.role ? eq(users.role, q.role) : sql`${users.role} in ('doctor','nurse')`))
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
    const me = currentUser(req)
    const q = parse(AuditQuery, req.query)
    // Only this facility's trail: rows carry their facility (migration 0017); older and anonymous
    // rows are matched through their actor or patient; rows tied to neither stay visible.
    const conds: SQL[] = [
      sql`(${auditEvents.facilityId} = ${me.facilityId} or (${auditEvents.facilityId} is null and coalesce((select fac_u.facility_id from ${users} fac_u where fac_u.id = ${auditEvents.actorUserId}), (select fac_p.facility_id from ${patients} fac_p where fac_p.id = ${auditEvents.patientId}), ${me.facilityId}) = ${me.facilityId}))`,
    ]
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
      .where(and(...conds))
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
    // Which trail was viewed: the validated filter values, and the patient or user it was about.
    await audit(db, req, {
      action: 'audit.read',
      patientId: q.patientId ?? null,
      ...(q.actorUserId && { entityType: 'user', entityId: q.actorUserId }),
      details: { filters: { action: q.action ?? null, actorUserId: q.actorUserId ?? null, patientId: q.patientId ?? null, outcome: q.outcome ?? null, from: q.from ?? null, to: q.to ?? null }, results: events.length },
    })
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
      .where(eq(users.facilityId, me.facilityId))
      .groupBy(users.role)
    const [sessionCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(sql`${sessions.expiresAt} > now()`, eq(users.facilityId, me.facilityId)))
    const [deptCount] = await db.select({ n: sql<number>`count(*)::int` }).from(departments).where(and(eq(departments.isActive, true), eq(departments.facilityId, me.facilityId)))
    // Failed sign-ins of this facility's accounts, plus attempts on unknown usernames (no facility).
    const [failedLogins] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(and(eq(auditEvents.action, 'auth.login'), eq(auditEvents.outcome, 'failure'), sql`${auditEvents.occurredAt} > now() - interval '24 hours'`, sql`(coalesce(${auditEvents.facilityId}, (select fac_u.facility_id from ${users} fac_u where fac_u.id = ${auditEvents.actorUserId})) = ${me.facilityId} or (${auditEvents.facilityId} is null and ${auditEvents.actorUserId} is null))`))
    return {
      users: Object.fromEntries(roleCounts.map((r) => [r.role, { active: r.active, total: r.total }])),
      activeSessions: sessionCount?.n ?? 0,
      activeDepartments: deptCount?.n ?? 0,
      failedLogins24h: failedLogins?.n ?? 0,
      queueToday: queue ?? { total: 0, waiting: 0, withDoctor: 0, completed: 0 },
    }
  })
}
