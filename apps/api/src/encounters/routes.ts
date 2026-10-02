import { AmendmentRequest, OPEN_VISIT_STATUSES, SaveDraftRequest, SignRequest, signIssues, type TimelineEntry } from '@adaxai/contracts'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { Db } from '../db/client.ts'
import { departments, diagnoses, encounterAmendments, encounters, prescriptionItems, users, visits } from '../db/schema.ts'
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { getPatientOr404 } from '../patients/service.ts'
import { canonicalJson, getEncounterOr404, loadEncounter, sha256 } from './service.ts'

const IdParams = z.object({ id: z.uuid() })

export function registerEncounterRoutes(app: FastifyInstance, { db }: { db: Db }) {
  /**
   * Start (or resume) the consultation for a visit. The visit moves to
   * "with doctor" and is assigned to the doctor who opens it.
   */
  app.post('/api/visits/:id/encounter', { config: { permission: 'encounters:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const visit = await db.query.visits.findFirst({ where: and(eq(visits.id, id), eq(visits.facilityId, me.facilityId)) })
    if (!visit) throw notFound('Visit')
    const existing = await db.query.encounters.findFirst({ where: eq(encounters.visitId, id) })
    if (existing) {
      // Resuming opens the full record, so it is audited like a read.
      await audit(db, req, { action: 'encounter.read', entityType: 'encounter', entityId: existing.id, patientId: existing.patientId, details: { via: 'resume', visitId: id } })
      return loadEncounter(db, me, existing)
    }
    if (!OPEN_VISIT_STATUSES.includes(visit.status)) throw conflict('This visit is closed', 'visit_closed')

    const created = await db.transaction(async (tx) => {
      const [e] = await tx
        .insert(encounters)
        .values({ facilityId: me.facilityId, patientId: visit.patientId, visitId: id, doctorId: me.id, chiefComplaint: visit.chiefComplaint ?? '' })
        .onConflictDoNothing({ target: encounters.visitId })
        .returning()
      if (!e) return null // another request created it first
      await tx
        .update(visits)
        .set({ status: 'in_consultation', assignedDoctorId: me.id, statusChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(visits.id, id))
      await audit(tx, req, {
        action: 'encounter.start',
        entityType: 'encounter',
        entityId: e.id,
        patientId: visit.patientId,
        details: { visitId: id, fromStatus: visit.status, ...(visit.assignedDoctorId && visit.assignedDoctorId !== me.id && { reassignedFrom: visit.assignedDoctorId }) },
      })
      return e
    })
    const e = created ?? (await db.query.encounters.findFirst({ where: eq(encounters.visitId, id) }))
    return reply.code(created ? 201 : 200).send(await loadEncounter(db, me, e!))
  })

  app.get('/api/encounters/:id', { config: { permission: 'encounters:read' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const e = await getEncounterOr404(db, me, id)
    await audit(db, req, { action: 'encounter.read', entityType: 'encounter', entityId: id, patientId: e.patientId })
    return loadEncounter(db, me, e)
  })

  /** Autosave of the working draft. Only the authoring doctor, only before signing. */
  app.put('/api/encounters/:id/draft', { config: { permission: 'encounters:write' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(SaveDraftRequest, req.body)
    const e = await getEncounterOr404(db, me, id)
    if (e.status === 'signed') throw conflict('This consultation is signed. Add an amendment instead.', 'encounter_signed')
    if (e.doctorId !== me.id) throw forbidden('Only the doctor who started this consultation can edit it')

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(encounters)
        .set({ ...body.note, version: sql`${encounters.version} + 1`, updatedAt: sql`now()` })
        .where(and(eq(encounters.id, id), eq(encounters.version, body.version), eq(encounters.status, 'in_progress')))
        .returning()
      if (!row) return null
      await tx.delete(diagnoses).where(eq(diagnoses.encounterId, id))
      if (body.diagnoses.length) await tx.insert(diagnoses).values(body.diagnoses.map((d, i) => ({ encounterId: id, description: d.description, code: d.code ?? null, kind: d.kind, sortOrder: i })))
      await tx.delete(prescriptionItems).where(eq(prescriptionItems.encounterId, id))
      if (body.prescription.length) await tx.insert(prescriptionItems).values(body.prescription.map((p, i) => ({ encounterId: id, ...p, sortOrder: i })))
      await audit(tx, req, { action: 'encounter.save', entityType: 'encounter', entityId: id, patientId: e.patientId, details: { version: row.version } })
      return row
    })
    if (!updated) {
      const current = await db.query.encounters.findFirst({ where: eq(encounters.id, id) })
      throw new HttpError(409, 'version_conflict', `This consultation was changed elsewhere (now version ${current?.version}). Reload to continue.`)
    }
    return loadEncounter(db, me, updated)
  })

  /** Signing freezes the record (database-enforced) and completes the visit. */
  app.post('/api/encounters/:id/sign', { config: { permission: 'encounters:sign' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(SignRequest, req.body)
    const e = await getEncounterOr404(db, me, id)
    if (e.status === 'signed') throw conflict('Already signed', 'encounter_signed')
    if (e.doctorId !== me.id) throw forbidden('Only the doctor who started this consultation can sign it')
    if (e.version !== body.version) throw new HttpError(409, 'version_conflict', 'Unsaved or newer changes exist. Review the latest version before signing.')

    const current = await loadEncounter(db, me, e)
    const missing = signIssues(current)
    if (missing.length) throw badRequest('The record is not complete enough to sign', missing)

    const signedAt = new Date()
    const snapshot = {
      encounterId: e.id,
      patient: { id: current.patient.id, mrn: current.patient.mrn, fullName: current.patient.fullName, dateOfBirth: current.patient.dateOfBirth, sex: current.patient.sex },
      doctor: current.doctor,
      visit: { visitDate: current.visit.visitDate, tokenNumber: current.visit.tokenNumber },
      note: current.note,
      diagnoses: current.diagnoses,
      prescription: current.prescription,
      // AI-produced text in the note keeps a reference to the AI artifact it came from.
      aiInsertions: current.aiInsertions.map((i) => ({ id: i.id, section: i.section, subjectType: i.subjectType, subjectId: i.subjectId, producedBy: i.producedBy, insertedAt: i.insertedAt, retained: i.retained })),
      signedAt: signedAt.toISOString(),
    }
    const contentHash = sha256(canonicalJson(snapshot))
    const signed = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(encounters)
        .set({ status: 'signed', signedAt, signedSnapshot: snapshot, contentHash, version: sql`${encounters.version} + 1`, updatedAt: sql`now()` })
        .where(and(eq(encounters.id, id), eq(encounters.version, body.version), eq(encounters.status, 'in_progress')))
        .returning()
      if (!row) throw new HttpError(409, 'version_conflict', 'The consultation changed while signing. Review and sign again.')
      await tx
        .update(visits)
        .set({ status: 'completed', statusChangedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(visits.id, e.visitId))
      await audit(tx, req, { action: 'encounter.sign', entityType: 'encounter', entityId: id, patientId: e.patientId, details: { contentHash } })
      return row
    })
    return loadEncounter(db, me, signed)
  })

  /** Post-signing correction: the original stays unchanged; the amendment is appended and attributed. */
  app.post('/api/encounters/:id/amendments', { config: { permission: 'encounters:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(AmendmentRequest, req.body)
    const e = await getEncounterOr404(db, me, id)
    if (e.status !== 'signed') throw conflict('Edit the draft directly; amendments are for signed records', 'not_signed')
    // Product decision (docs/STATUS.md): only the doctor who signed a consultation amends it.
    if (e.doctorId !== me.id) throw forbidden('Only the doctor who signed this consultation can amend it')
    await db.transaction(async (tx) => {
      const [a] = await tx.insert(encounterAmendments).values({ encounterId: id, authorId: me.id, reason: body.reason, content: body.content }).returning({ id: encounterAmendments.id })
      await audit(tx, req, { action: 'encounter.amend', entityType: 'encounter', entityId: id, patientId: e.patientId, details: { amendmentId: a!.id } })
    })
    return reply.code(201).send(await loadEncounter(db, me, e))
  })

  /** Patient timeline: every visit, with consultation summaries where they exist. */
  app.get('/api/patients/:id/timeline', { config: { permission: 'patients:read' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    await getPatientOr404(db, me.facilityId, id)
    const doctor = alias(users, 'doctor')
    const rows = await db
      .select({ v: visits, e: encounters, deptName: departments.name, doctorName: doctor.fullName })
      .from(visits)
      .innerJoin(departments, eq(departments.id, visits.departmentId))
      .leftJoin(encounters, eq(encounters.visitId, visits.id))
      .leftJoin(doctor, eq(doctor.id, sql`coalesce(${encounters.doctorId}, ${visits.assignedDoctorId})`))
      .where(and(eq(visits.patientId, id), eq(visits.facilityId, me.facilityId)))
      .orderBy(desc(visits.visitDate), desc(visits.tokenNumber))
    const encIds = rows.flatMap((r) => (r.e ? [r.e.id] : []))
    const [dx, rx, am] = encIds.length
      ? await Promise.all([
          db.select().from(diagnoses).where(inArray(diagnoses.encounterId, encIds)).orderBy(asc(diagnoses.sortOrder)),
          db.select().from(prescriptionItems).where(inArray(prescriptionItems.encounterId, encIds)).orderBy(asc(prescriptionItems.sortOrder)),
          db.select({ encounterId: encounterAmendments.encounterId, n: sql<number>`count(*)::int` }).from(encounterAmendments).where(inArray(encounterAmendments.encounterId, encIds)).groupBy(encounterAmendments.encounterId),
        ])
      : [[], [], []]
    const entries: TimelineEntry[] = rows.map(({ v, e, deptName, doctorName }) => ({
      kind: e ? 'encounter' : 'visit',
      id: e?.id ?? v.id,
      date: v.visitDate,
      title: e ? (e.status === 'signed' ? 'Consultation' : 'Consultation in progress') : 'OPD visit',
      status: e ? e.status : v.status,
      doctorName,
      departmentName: deptName,
      diagnoses: dx.filter((d) => d.encounterId === e?.id).map((d) => (d.code ? `${d.description} (${d.code})` : d.description)),
      medications: rx.filter((r) => r.encounterId === e?.id).map((r) => [r.drugName, r.strength].filter(Boolean).join(' ')),
      amendmentCount: am.find((a) => a.encounterId === e?.id)?.n ?? 0,
      encounterId: e?.id ?? null,
    }))
    await audit(db, req, { action: 'patient.timeline_read', entityType: 'patient', entityId: id, patientId: id })
    return { entries }
  })
}
