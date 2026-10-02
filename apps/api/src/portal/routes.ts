import { CONSENT_LABELS, type ConsentType, type PortalConsent, type PortalHome, type PortalProfile, type PortalRecord, type PortalRecordSummary, type PortalThermalReport, type PortalVisit, type PortalVital } from '@adaxai/contracts'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { Db } from '../db/client.ts'
import { allergies, consents, departments, diagnoses, encounterAmendments, encounters, facilities, observations, patients, prescriptionItems, thermalCaptures, users, visits } from '../db/schema.ts'
import { forbidden, notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'

/**
 * Patient portal API. Every query is scoped to the patient linked to the
 * signed-in account (session.patientId); no route accepts a patient id.
 * Only finalised information is shown: signed consultation records (with
 * amendments), measured vital signs, doctor-approved thermal measurements.
 * Drafts, unreviewed AI output, transcripts, audio and photographs are not
 * part of the portal.
 */
export function registerPortalRoutes(app: FastifyInstance, deps: { db: Db }) {
  const { db } = deps
  const perm = { config: { permission: 'portal:self' as const } }

  function self(req: FastifyRequest) {
    const me = currentUser(req)
    if (me.role !== 'patient' || !me.patientId) throw forbidden('This account is not linked to a patient record')
    return { me, patientId: me.patientId }
  }

  const read = (req: FastifyRequest, patientId: string, what: string, entityId?: string) => audit(db, req, { action: 'portal.read', entityType: what, entityId: entityId ?? patientId, patientId, details: { what } })

  async function signedRecords(patientId: string) {
    const doctor = alias(users, 'doctor')
    const rows = await db
      .select({ e: encounters, doctorName: doctor.fullName, reg: doctor.registrationNumber, dept: departments.name })
      .from(encounters)
      .innerJoin(doctor, eq(doctor.id, encounters.doctorId))
      .innerJoin(visits, eq(visits.id, encounters.visitId))
      .innerJoin(departments, eq(departments.id, visits.departmentId))
      .where(and(eq(encounters.patientId, patientId), eq(encounters.status, 'signed')))
      .orderBy(desc(encounters.signedAt))
    const ids = rows.map((r) => r.e.id)
    const dx = ids.length ? await db.select().from(diagnoses).where(inArray(diagnoses.encounterId, ids)).orderBy(asc(diagnoses.sortOrder)) : []
    const rx = ids.length ? await db.select().from(prescriptionItems).where(inArray(prescriptionItems.encounterId, ids)).orderBy(asc(prescriptionItems.sortOrder)) : []
    return { rows, dx, rx }
  }

  const summary = (r: Awaited<ReturnType<typeof signedRecords>>['rows'][number], dx: (typeof diagnoses.$inferSelect)[], rx: (typeof prescriptionItems.$inferSelect)[]): PortalRecordSummary => ({
    id: r.e.id,
    signedAt: r.e.signedAt!.toISOString(),
    doctorName: r.doctorName,
    departmentName: r.dept,
    chiefComplaint: r.e.chiefComplaint,
    diagnoses: dx.filter((d) => d.encounterId === r.e.id).map((d) => ({ description: d.description, code: d.code })),
    prescriptionCount: rx.filter((p) => p.encounterId === r.e.id).length,
    followUp: r.e.followUp,
  })

  async function visitList(patientId: string): Promise<PortalVisit[]> {
    const doctor = alias(users, 'doctor')
    const rows = await db
      .select({ v: visits, dept: departments.name, doctorName: doctor.fullName, encId: encounters.id, encStatus: encounters.status })
      .from(visits)
      .innerJoin(departments, eq(departments.id, visits.departmentId))
      .leftJoin(encounters, eq(encounters.visitId, visits.id))
      .leftJoin(doctor, eq(doctor.id, encounters.doctorId))
      .where(eq(visits.patientId, patientId))
      .orderBy(desc(visits.visitDate), desc(visits.checkedInAt))
    return rows.map(({ v, dept, doctorName, encId, encStatus }) => ({
      id: v.id,
      visitDate: String(v.visitDate),
      tokenNumber: v.tokenNumber,
      departmentName: dept,
      doctorName,
      status: v.status,
      reasonForVisit: v.chiefComplaint,
      recordId: encStatus === 'signed' ? encId : null,
    }))
  }

  app.get('/api/portal/home', perm, async (req): Promise<PortalHome> => {
    const { patientId } = self(req)
    const p = (await db.query.patients.findFirst({ where: eq(patients.id, patientId) }))!
    const { rows } = await signedRecords(patientId)
    const visitsOut = await visitList(patientId)
    await read(req, patientId, 'home')
    return {
      profile: { fullName: [p.givenName, p.familyName].filter(Boolean).join(' '), mrn: p.mrn },
      upcoming: rows
        .filter((r) => r.e.followUp.trim())
        .slice(0, 3)
        .map((r) => ({ recordId: r.e.id, signedAt: r.e.signedAt!.toISOString(), followUp: r.e.followUp, doctorName: r.doctorName })),
      lastVisit: visitsOut[0] ?? null,
      counts: { records: rows.length, visits: visitsOut.length },
    }
  })

  app.get('/api/portal/profile', perm, async (req): Promise<PortalProfile> => {
    const { patientId } = self(req)
    const [row] = await db.select({ p: patients, facility: facilities.name }).from(patients).innerJoin(facilities, eq(facilities.id, patients.facilityId)).where(eq(patients.id, patientId))
    const p = row!.p
    const al = await db.select().from(allergies).where(and(eq(allergies.patientId, patientId), eq(allergies.status, 'active')))
    await read(req, patientId, 'profile')
    return {
      mrn: p.mrn,
      fullName: [p.givenName, p.familyName].filter(Boolean).join(' '),
      dateOfBirth: String(p.dateOfBirth),
      sex: p.sex,
      phone: p.phone,
      email: p.email,
      address: [p.addressLine, p.city, p.state, p.postalCode].filter(Boolean).join(', ') || null,
      bloodGroup: p.bloodGroup,
      preferredLanguage: p.preferredLanguage,
      emergencyContact: { name: p.emergencyContactName, phone: p.emergencyContactPhone },
      allergies: al.map((a) => ({ substance: a.substance, reaction: a.reaction, severity: a.severity })),
      noKnownAllergies: p.noKnownAllergies,
      facilityName: row!.facility,
    }
  })

  app.get('/api/portal/visits', perm, async (req) => {
    const { patientId } = self(req)
    const out = await visitList(patientId)
    await read(req, patientId, 'visits')
    return { visits: out }
  })

  app.get('/api/portal/records', perm, async (req) => {
    const { patientId } = self(req)
    const { rows, dx, rx } = await signedRecords(patientId)
    await read(req, patientId, 'records')
    return { records: rows.map((r) => summary(r, dx, rx)) }
  })

  /** One signed record. Another patient's record, or an unsigned draft, is "not found". */
  app.get('/api/portal/records/:id', perm, async (req): Promise<PortalRecord> => {
    const { patientId } = self(req)
    const { id } = parse(z.object({ id: z.uuid() }), req.params)
    const { rows, dx, rx } = await signedRecords(patientId)
    const r = rows.find((x) => x.e.id === id)
    if (!r) throw notFound('Record')
    const author = alias(users, 'author')
    const am = await db.select({ a: encounterAmendments, name: author.fullName }).from(encounterAmendments).innerJoin(author, eq(author.id, encounterAmendments.authorId)).where(eq(encounterAmendments.encounterId, id)).orderBy(asc(encounterAmendments.createdAt))
    await read(req, patientId, 'record', id)
    return {
      ...summary(r, dx, rx),
      doctorRegistrationNumber: r.reg,
      history: r.e.history,
      examination: r.e.examination,
      assessment: r.e.assessment,
      plan: r.e.plan,
      prescription: rx
        .filter((p) => p.encounterId === id)
        .map((p) => ({ drugName: p.drugName, strength: p.strength, form: p.form, dose: p.dose, route: p.route, frequency: p.frequency, duration: p.duration, instructions: p.instructions })),
      amendments: am.map(({ a, name }) => ({ createdAt: a.createdAt.toISOString(), authorName: name, reason: a.reason, content: a.content })),
      contentHash: r.e.contentHash ?? '',
    }
  })

  app.get('/api/portal/vitals', perm, async (req) => {
    const { patientId } = self(req)
    const rows = await db.select().from(observations).where(and(eq(observations.patientId, patientId), eq(observations.enteredInError, false))).orderBy(desc(observations.measuredAt)).limit(500)
    await read(req, patientId, 'vitals')
    return { vitals: rows.map((o): PortalVital => ({ kind: o.kind as PortalVital['kind'], value: o.value, unit: o.unit, measuredAt: o.measuredAt.toISOString(), source: o.source as PortalVital['source'] })) }
  })

  app.get('/api/portal/consents', perm, async (req) => {
    const { patientId } = self(req)
    const rows = await db.select().from(consents).where(eq(consents.patientId, patientId)).orderBy(desc(consents.recordedAt))
    await read(req, patientId, 'consents')
    return {
      consents: rows.map(
        (c): PortalConsent => ({
          type: c.type as ConsentType,
          title: CONSENT_LABELS[c.type as ConsentType].title,
          description: CONSENT_LABELS[c.type as ConsentType].description,
          status: c.withdrawnAt ? 'withdrawn' : (c.status as 'granted'),
          scope: c.scope,
          method: c.method,
          recordedAt: c.recordedAt.toISOString(),
          withdrawnAt: c.withdrawnAt?.toISOString() ?? null,
          version: c.version,
        }),
      ),
    }
  })

  /** Doctor-approved thermal measurements (measurements only). */
  app.get('/api/portal/thermal', perm, async (req) => {
    const { patientId } = self(req)
    const rows = await db.select().from(thermalCaptures).where(and(eq(thermalCaptures.patientId, patientId), eq(thermalCaptures.status, 'approved'))).orderBy(desc(thermalCaptures.createdAt))
    await read(req, patientId, 'thermal')
    return {
      reports: rows.map((t): PortalThermalReport => {
        const cam = t.camera as { make: string | null; model: string | null }
        return {
          id: t.id,
          createdAt: t.createdAt.toISOString(),
          bodyRegion: (t.protocol as { bodyRegion: string }).bodyRegion,
          reviewedAt: t.reviewedAt?.toISOString() ?? null,
          pairs: (t.pairStats as { a: string; b: string; meanDiff: number | null }[]).map((p) => ({ a: p.a, b: p.b, meanDiff: p.meanDiff })),
          camera: [cam.make, cam.model].filter(Boolean).join(' ') || null,
          dataOrigin: t.dataOrigin,
        }
      }),
    }
  })
}
