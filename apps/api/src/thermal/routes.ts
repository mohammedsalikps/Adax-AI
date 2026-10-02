import { CaptureProtocol, SaveRoisRequest, type ThermalCapture, type ThermalPair, ThermalReviewRequest } from '@adaxai/contracts'
import { and, asc, desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { SessionUser } from '../auth/sessions.ts'
import type { Config } from '../config.ts'
import type { Db } from '../db/client.ts'
import { encounters, files, patients, thermalCaptures, thermalRois, users } from '../db/schema.ts'
import { readStoredBytes, storeBytes } from '../files/storage.ts'
import { badRequest, conflict, HttpError, notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { activeConsent, getPatientOr404 } from '../patients/service.ts'
import type { ThermalService } from './client.ts'

const IdParams = z.object({ id: z.uuid() })
type CaptureRow = typeof thermalCaptures.$inferSelect

async function toCapture(db: Db, c: CaptureRow): Promise<ThermalCapture> {
  const creator = alias(users, 'creator')
  const reviewer = alias(users, 'reviewer')
  const [names] = await db
    .select({ createdByName: creator.fullName, reviewedByName: reviewer.fullName, originalName: files.originalName })
    .from(thermalCaptures)
    .leftJoin(creator, eq(creator.id, thermalCaptures.createdBy))
    .leftJoin(reviewer, eq(reviewer.id, thermalCaptures.reviewedBy))
    .innerJoin(files, eq(files.id, thermalCaptures.rawFileId))
    .where(eq(thermalCaptures.id, c.id))
  const rois = await db.select().from(thermalRois).where(eq(thermalRois.captureId, c.id)).orderBy(asc(thermalRois.sortOrder))
  return {
    id: c.id,
    patientId: c.patientId,
    encounterId: c.encounterId,
    status: c.status as ThermalCapture['status'],
    originalName: names?.originalName ?? null,
    width: c.width,
    height: c.height,
    minC: c.minC,
    maxC: c.maxC,
    meanC: c.meanC,
    camera: c.camera as ThermalCapture['camera'],
    parameters: c.parameters as ThermalCapture['parameters'],
    protocol: c.protocol as ThermalCapture['protocol'],
    extractor: c.extractor as ThermalCapture['extractor'],
    rawFileId: c.rawFileId,
    matrixFileId: c.matrixFileId,
    visibleFileId: c.visibleFileId,
    rois: rois.map((r) => ({ id: r.id, label: r.label, shape: r.shape as 'rect' | 'ellipse', x: r.x, y: r.y, width: r.width, height: r.height, pairWith: r.pairWith, stats: r.stats as ThermalCapture['rois'][number]['stats'] })),
    pairs: c.pairStats as ThermalPair[],
    review: c.reviewedAt ? { byName: names?.reviewedByName ?? null, at: c.reviewedAt.toISOString(), note: c.reviewNote } : null,
    createdAt: c.createdAt.toISOString(),
    createdByName: names?.createdByName ?? null,
  }
}

export function registerThermalRoutes(app: FastifyInstance, deps: { db: Db; config: Config; thermal: ThermalService }) {
  const { db, config, thermal } = deps

  async function getCaptureOr404(me: SessionUser, id: string) {
    const c = await db.query.thermalCaptures.findFirst({ where: and(eq(thermalCaptures.id, id), eq(thermalCaptures.facilityId, me.facilityId)) })
    if (!c) throw notFound('Thermal image')
    return c
  }

  /** Upload a radiometric JPEG. Requires the patient's consent to thermal imaging. */
  app.post('/api/patients/:id/thermal', { config: { permission: 'thermal:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    await getPatientOr404(db, me.facilityId, id)
    if (!(await activeConsent(db, id, 'thermal_imaging'))) throw new HttpError(409, 'consent_required', 'Record the patient’s consent to thermal imaging first')
    const part = await req.file()
    if (!part) throw badRequest('Attach a thermal image', [{ path: 'file', message: 'Required' }])
    const data = await part.toBuffer()
    const field = (name: string) => {
      const f = part.fields[name] as { value?: unknown } | undefined
      return typeof f?.value === 'string' ? f.value : undefined
    }
    let protocolInput: unknown
    try {
      protocolInput = JSON.parse(field('protocol') ?? '{}')
    } catch {
      throw badRequest('Some fields are invalid', [{ path: 'protocol', message: 'Invalid capture details' }])
    }
    const protocol = parse(CaptureProtocol, protocolInput)
    const encounterId = field('encounterId') || null
    if (encounterId) {
      const e = await db.query.encounters.findFirst({ where: and(eq(encounters.id, encounterId), eq(encounters.patientId, id)) })
      if (!e) throw badRequest('Some fields are invalid', [{ path: 'encounterId', message: 'Not a consultation of this patient' }])
    }
    if (!data.length) throw badRequest('The file is empty', [{ path: 'file', message: 'Empty file' }])

    // The Python service validates and decodes; 422 rejections are passed through as-is.
    const ex = await thermal.extract(data, 'upload.jpg')
    if (ex.matrix.length !== ex.width * ex.height * 4) throw new HttpError(502, 'thermal_invalid', 'The thermal service returned an inconsistent matrix.')

    const raw = await storeBytes(config.storageDir, data, '.jpg')
    const matrix = await storeBytes(config.storageDir, ex.matrix, '.f32')
    const visible = ex.visibleJpeg ? await storeBytes(config.storageDir, ex.visibleJpeg, '.jpg') : null
    const created = await db.transaction(async (tx) => {
      const base = { facilityId: me.facilityId, patientId: id, encounterId, uploadedBy: me.id }
      const [rawFile] = await tx.insert(files).values({ ...base, kind: 'thermal_raw', storageKey: raw.storageKey, originalName: (part.filename || 'thermal.jpg').slice(0, 120), mimeType: 'image/jpeg', sizeBytes: raw.sizeBytes, sha256: raw.sha256 }).returning({ id: files.id })
      const [matrixFile] = await tx.insert(files).values({ ...base, kind: 'thermal_matrix', storageKey: matrix.storageKey, originalName: 'matrix.f32', mimeType: 'application/octet-stream', sizeBytes: matrix.sizeBytes, sha256: matrix.sha256 }).returning({ id: files.id })
      const visibleFile = visible
        ? (await tx.insert(files).values({ ...base, kind: 'thermal_visible', storageKey: visible.storageKey, originalName: 'visible.jpg', mimeType: 'image/jpeg', sizeBytes: visible.sizeBytes, sha256: visible.sha256 }).returning({ id: files.id }))[0]
        : null
      const [c] = await tx
        .insert(thermalCaptures)
        .values({
          facilityId: me.facilityId,
          patientId: id,
          encounterId,
          rawFileId: rawFile!.id,
          matrixFileId: matrixFile!.id,
          visibleFileId: visibleFile?.id ?? null,
          width: ex.width,
          height: ex.height,
          minC: ex.minC,
          maxC: ex.maxC,
          meanC: ex.meanC,
          camera: ex.camera,
          parameters: ex.parameters,
          extractor: ex.extractor,
          protocol,
          createdBy: me.id,
        })
        .returning()
      await audit(tx, req, { action: 'thermal.upload', entityType: 'thermal_capture', entityId: c!.id, patientId: id, details: { width: ex.width, height: ex.height, extractor: ex.extractor.version } })
      return c!
    })
    return reply.code(201).send(await toCapture(db, created))
  })

  app.get('/api/patients/:id/thermal', { config: { permission: 'patients:read' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    await getPatientOr404(db, me.facilityId, id)
    const rows = await db.select().from(thermalCaptures).where(and(eq(thermalCaptures.patientId, id), eq(thermalCaptures.facilityId, me.facilityId))).orderBy(desc(thermalCaptures.createdAt))
    await audit(db, req, { action: 'thermal.list', entityType: 'patient', entityId: id, patientId: id })
    return { captures: await Promise.all(rows.map((r) => toCapture(db, r))) }
  })

  /** Recent captures across the facility, e.g. those awaiting a doctor's review. */
  app.get('/api/thermal', { config: { permission: 'patients:read' } }, async (req) => {
    const me = currentUser(req)
    const q = parse(z.object({ status: z.enum(['draft', 'approved', 'rejected']).optional() }), req.query)
    const rows = await db
      .select({ c: thermalCaptures, given: patients.givenName, family: patients.familyName, mrn: patients.mrn })
      .from(thermalCaptures)
      .innerJoin(patients, eq(patients.id, thermalCaptures.patientId))
      .where(and(eq(thermalCaptures.facilityId, me.facilityId), q.status ? eq(thermalCaptures.status, q.status) : undefined))
      .orderBy(desc(thermalCaptures.createdAt))
      .limit(50)
    await audit(db, req, { action: 'thermal.list', details: { status: q.status ?? null, count: rows.length } })
    return {
      captures: rows.map(({ c, given, family, mrn }) => ({
        id: c.id,
        patientId: c.patientId,
        patientName: [given, family].filter(Boolean).join(' '),
        mrn,
        status: c.status,
        bodyRegion: (c.protocol as { bodyRegion: string }).bodyRegion,
        createdAt: c.createdAt.toISOString(),
      })),
    }
  })

  app.get('/api/thermal/:id', { config: { permission: 'patients:read' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const c = await getCaptureOr404(me, id)
    await audit(db, req, { action: 'thermal.read', entityType: 'thermal_capture', entityId: id, patientId: c.patientId })
    return toCapture(db, c)
  })

  /** Replaces the regions of a draft capture; statistics are computed by the thermal service. */
  app.put('/api/thermal/:id/rois', { config: { permission: 'thermal:write' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(SaveRoisRequest, req.body)
    const c = await getCaptureOr404(me, id)
    if (c.status !== 'draft') throw conflict('This thermal image has been reviewed; its regions can no longer change', 'thermal_reviewed')
    for (const [i, r] of body.rois.entries()) {
      if (r.x + r.width > c.width + 0.01 || r.y + r.height > c.height + 0.01) throw badRequest('Some fields are invalid', [{ path: `rois.${i}`, message: 'Region extends beyond the image' }])
    }
    const matrixFile = (await db.query.files.findFirst({ where: eq(files.id, c.matrixFileId) }))!
    const matrix = await readStoredBytes(config.storageDir, matrixFile.storageKey)
    const keyOf = (label: string) => label.trim().toLowerCase()
    const pairs = body.rois.filter((r) => r.pairWith).map((r) => ({ a: keyOf(r.label), b: keyOf(r.pairWith!) }))
    const uniquePairs = pairs.filter((p, i) => pairs.findIndex((q) => (q.a === p.a && q.b === p.b) || (q.a === p.b && q.b === p.a)) === i)
    const result = body.rois.length
      ? await thermal.roiStats({ width: c.width, height: c.height, matrix, rois: body.rois.map((r) => ({ id: keyOf(r.label), shape: r.shape, x: r.x, y: r.y, width: r.width, height: r.height })), pairs: uniquePairs })
      : { rois: [], pairs: [] }
    const labelOf = new Map(body.rois.map((r) => [keyOf(r.label), r.label.trim()]))
    await db.transaction(async (tx) => {
      await tx.delete(thermalRois).where(eq(thermalRois.captureId, id))
      if (body.rois.length) {
        await tx.insert(thermalRois).values(
          body.rois.map((r, i) => ({
            captureId: id,
            label: r.label.trim(),
            shape: r.shape,
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            pairWith: r.pairWith?.trim() || null,
            stats: result.rois.find((s) => s.id === keyOf(r.label))!.stats,
            sortOrder: i,
            createdBy: me.id,
          })),
        )
      }
      await tx
        .update(thermalCaptures)
        .set({ pairStats: result.pairs.map((p) => ({ ...p, a: labelOf.get(p.a) ?? p.a, b: labelOf.get(p.b) ?? p.b })) })
        .where(eq(thermalCaptures.id, id))
      await audit(tx, req, { action: 'thermal.rois_save', entityType: 'thermal_capture', entityId: id, patientId: c.patientId, details: { rois: body.rois.length } })
    })
    return toCapture(db, (await getCaptureOr404(me, id))!)
  })

  /** Doctor review. Approval means the measurements are fit to keep on record, not a diagnosis. */
  app.post('/api/thermal/:id/review', { config: { permission: 'thermal:approve' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(ThermalReviewRequest, req.body)
    const c = await getCaptureOr404(me, id)
    if (c.status !== 'draft') throw conflict('Already reviewed', 'thermal_reviewed')
    if (body.decision === 'rejected' && !body.note) throw badRequest('Some fields are invalid', [{ path: 'note', message: 'Give a reason for rejecting' }])
    await db.transaction(async (tx) => {
      await tx.update(thermalCaptures).set({ status: body.decision, reviewNote: body.note ?? null, reviewedBy: me.id, reviewedAt: new Date() }).where(and(eq(thermalCaptures.id, id), eq(thermalCaptures.status, 'draft')))
      await audit(tx, req, { action: 'thermal.review', entityType: 'thermal_capture', entityId: id, patientId: c.patientId, details: { decision: body.decision } })
    })
    return toCapture(db, (await getCaptureOr404(me, id))!)
  })
}
