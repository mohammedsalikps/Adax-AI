import crypto from 'node:crypto'
import {
  type ActivationCodeResponse,
  AllergyInput,
  CreatePatientRequest,
  type DuplicateCandidate,
  RecordConsentRequest,
  UpdatePatientRequest,
} from '@adaxai/contracts'
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { Db } from '../db/client.ts'
import { allergies, consents, patientActivationCodes, patients, users, visits } from '../db/schema.ts'
import { conflict, notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { activeConsent, fullName, getPatientOr404, loadPatientDetail, toSummary } from './service.ts'

const PatientParams = z.object({ id: z.uuid() })
const SubParams = z.object({ id: z.uuid(), subId: z.uuid() })
const SearchQuery = z.object({ q: z.string().trim().max(80).optional(), limit: z.coerce.number().int().min(1).max(50).default(25) })

const ACTIVATION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export const hashActivationCode = (code: string) => crypto.createHash('sha256').update(code.replace(/[\s-]/g, '').toUpperCase()).digest('hex')

function newActivationCode(): string {
  const bytes = crypto.randomBytes(10)
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`
}

const escapeLike = (s: string) => s.replace(/[%_\\]/g, '\\$&')

export function registerPatientRoutes(app: FastifyInstance, { db }: { db: Db }) {
  // ---- Search / list ----
  app.get('/api/patients', { config: { permission: 'patients:read' } }, async (req) => {
    const me = currentUser(req)
    const { q, limit } = parse(SearchQuery, req.query)
    const lastVisit = sql<string | null>`(select max(${visits.visitDate})::text from ${visits} where ${visits.patientId} = ${patients.id})`
    let rows
    if (!q) {
      rows = await db.select({ p: patients, lastVisit }).from(patients).where(eq(patients.facilityId, me.facilityId)).orderBy(desc(patients.updatedAt)).limit(limit)
    } else {
      const digits = q.replace(/\D/g, '')
      const term = q.toLowerCase()
      const conds = [sql`${patients.mrn} ilike ${`${escapeLike(q)}%`}`, sql`${patients.searchName} ilike ${`%${escapeLike(term)}%`}`, sql`${patients.searchName} % ${term}`]
      if (digits.length >= 4) conds.push(sql`${patients.phone} like ${`%${digits}%`}`)
      rows = await db
        .select({ p: patients, lastVisit })
        .from(patients)
        .where(and(eq(patients.facilityId, me.facilityId), or(...conds)))
        .orderBy(sql`(${patients.mrn} = ${q}) desc`, sql`similarity(${patients.searchName}, ${term}) desc`, desc(patients.updatedAt))
        .limit(limit)
    }
    // Search terms can be names, so only their length is audited.
    await audit(db, req, { action: 'patient.search', details: { queryLength: q?.length ?? 0, results: rows.length } })
    return { patients: rows.map(({ p, lastVisit: lv }) => toSummary(p, lv)) }
  })

  // ---- Register ----
  app.post('/api/patients', { config: { permission: 'patients:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const body = parse(CreatePatientRequest, req.body)
    const { confirmNotDuplicate, ...data } = body

    if (!confirmNotDuplicate) {
      const name = `${data.givenName} ${data.familyName ?? ''}`.trim().toLowerCase()
      const dupes = await db
        .select()
        .from(patients)
        .where(and(eq(patients.facilityId, me.facilityId), or(eq(patients.phone, data.phone), and(eq(patients.dateOfBirth, data.dateOfBirth), sql`trim(${patients.searchName}) = ${name}`))))
        .limit(5)
      if (dupes.length) {
        const candidates: DuplicateCandidate[] = dupes.map((p) => ({ id: p.id, mrn: p.mrn, fullName: fullName(p), dateOfBirth: p.dateOfBirth, phone: p.phone }))
        return reply.code(409).send({ error: 'possible_duplicate', message: 'A patient with the same phone number, or the same name and date of birth, already exists.', candidates })
      }
    }

    const created = await db.transaction(async (tx) => {
      const [p] = await tx
        .insert(patients)
        .values({ ...data, facilityId: me.facilityId, createdBy: me.id })
        .returning()
      await audit(tx, req, { action: 'patient.create', entityType: 'patient', entityId: p!.id, patientId: p!.id, details: { mrn: p!.mrn, duplicateWarningOverridden: !!confirmNotDuplicate } })
      return p!
    })
    return reply.code(201).send(await loadPatientDetail(db, created))
  })

  // ---- Read / update ----
  app.get('/api/patients/:id', { config: { permission: 'patients:read' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const p = await getPatientOr404(db, me.facilityId, id)
    await audit(db, req, { action: 'patient.read', entityType: 'patient', entityId: id, patientId: id })
    return loadPatientDetail(db, p)
  })

  app.patch('/api/patients/:id', { config: { permission: 'patients:write' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const body = parse(UpdatePatientRequest, req.body)
    await getPatientOr404(db, me.facilityId, id)
    const [p] = await db.transaction(async (tx) => {
      const r = await tx
        .update(patients)
        .set({ ...body, updatedAt: sql`now()` })
        .where(eq(patients.id, id))
        .returning()
      await audit(tx, req, { action: 'patient.update', entityType: 'patient', entityId: id, patientId: id, details: { changed: Object.keys(body) } })
      return r
    })
    return loadPatientDetail(db, p!)
  })

  // ---- Allergies ----
  app.post('/api/patients/:id/allergies', { config: { permission: 'patients:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const body = parse(AllergyInput, req.body)
    await getPatientOr404(db, me.facilityId, id)
    await db.transaction(async (tx) => {
      const [a] = await tx.insert(allergies).values({ patientId: id, ...body, recordedBy: me.id }).returning({ id: allergies.id })
      // Recording an allergy contradicts "no known allergies".
      await tx.update(patients).set({ noKnownAllergies: false, updatedAt: sql`now()` }).where(eq(patients.id, id))
      await audit(tx, req, { action: 'allergy.create', entityType: 'allergy', entityId: a!.id, patientId: id })
    })
    return reply.code(201).send(await loadPatientDetail(db, await getPatientOr404(db, me.facilityId, id)))
  })

  app.post('/api/patients/:id/allergies/:subId/deactivate', { config: { permission: 'patients:write' } }, async (req) => {
    const me = currentUser(req)
    const { id, subId } = parse(SubParams, req.params)
    await getPatientOr404(db, me.facilityId, id)
    const [a] = await db
      .update(allergies)
      .set({ status: 'inactive', updatedAt: sql`now()` })
      .where(and(eq(allergies.id, subId), eq(allergies.patientId, id)))
      .returning({ id: allergies.id })
    if (!a) throw notFound('Allergy')
    await audit(db, req, { action: 'allergy.deactivate', entityType: 'allergy', entityId: subId, patientId: id })
    return loadPatientDetail(db, await getPatientOr404(db, me.facilityId, id))
  })

  app.put('/api/patients/:id/no-known-allergies', { config: { permission: 'patients:write' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const { noKnownAllergies } = parse(z.object({ noKnownAllergies: z.boolean() }), req.body)
    await getPatientOr404(db, me.facilityId, id)
    if (noKnownAllergies) {
      const active = await db.query.allergies.findFirst({ where: and(eq(allergies.patientId, id), eq(allergies.status, 'active')) })
      if (active) throw conflict('Deactivate the recorded allergies first', 'has_active_allergies')
    }
    await db.update(patients).set({ noKnownAllergies, updatedAt: sql`now()` }).where(eq(patients.id, id))
    await audit(db, req, { action: 'patient.no_known_allergies', entityType: 'patient', entityId: id, patientId: id, details: { noKnownAllergies } })
    return loadPatientDetail(db, await getPatientOr404(db, me.facilityId, id))
  })

  // ---- Consents ----
  app.post('/api/patients/:id/consents', { config: { permission: 'consents:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const body = parse(RecordConsentRequest, req.body)
    await getPatientOr404(db, me.facilityId, id)
    if (await activeConsent(db, id, body.type)) throw conflict('This consent is already recorded as granted', 'already_granted')
    await db.transaction(async (tx) => {
      const [c] = await tx.insert(consents).values({ patientId: id, type: body.type, method: body.method, notes: body.notes ?? null, recordedBy: me.id }).returning({ id: consents.id })
      await audit(tx, req, { action: 'consent.grant', entityType: 'consent', entityId: c!.id, patientId: id, details: { type: body.type, method: body.method } })
    })
    return reply.code(201).send(await loadPatientDetail(db, await getPatientOr404(db, me.facilityId, id)))
  })

  app.post('/api/patients/:id/consents/:subId/withdraw', { config: { permission: 'consents:write' } }, async (req) => {
    const me = currentUser(req)
    const { id, subId } = parse(SubParams, req.params)
    await getPatientOr404(db, me.facilityId, id)
    const [c] = await db
      .update(consents)
      .set({ status: 'withdrawn', withdrawnAt: sql`now()`, withdrawnBy: me.id })
      .where(and(eq(consents.id, subId), eq(consents.patientId, id), eq(consents.status, 'granted')))
      .returning({ type: consents.type })
    if (!c) throw notFound('Active consent')
    await audit(db, req, { action: 'consent.withdraw', entityType: 'consent', entityId: subId, patientId: id, details: { type: c.type } })
    return loadPatientDetail(db, await getPatientOr404(db, me.facilityId, id))
  })

  // ---- Patient portal activation code (shown once to staff, handed to the patient) ----
  app.post('/api/patients/:id/portal-activation', { config: { permission: 'patients:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(PatientParams, req.params)
    const p = await getPatientOr404(db, me.facilityId, id)
    const account = await db.query.users.findFirst({ where: eq(users.patientId, id) })
    if (account) throw conflict('This patient already has a portal account', 'portal_account_exists')
    if (!(await activeConsent(db, id, 'portal_access'))) throw conflict('Record the patient’s consent to portal access first', 'consent_required')
    const code = newActivationCode()
    const expiresAt = new Date(Date.now() + ACTIVATION_TTL_MS)
    await db.transaction(async (tx) => {
      await tx
        .update(patientActivationCodes)
        .set({ revokedAt: sql`now()` })
        .where(and(eq(patientActivationCodes.patientId, id), isNull(patientActivationCodes.usedAt), isNull(patientActivationCodes.revokedAt)))
      await tx.insert(patientActivationCodes).values({ patientId: id, codeHash: hashActivationCode(code), expiresAt, createdBy: me.id })
      await audit(tx, req, { action: 'patient.portal_code_issue', entityType: 'patient', entityId: id, patientId: id })
    })
    const body: ActivationCodeResponse = { activationCode: code, expiresAt: expiresAt.toISOString(), mrn: p.mrn }
    return reply.code(201).send(body)
  })
}
