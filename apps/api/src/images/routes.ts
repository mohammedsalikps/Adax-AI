import path from 'node:path'
import { type ClinicalImage, type ImageAnalysis, ImageUploadFields, JobRequest } from '@adaxai/contracts'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { SessionUser } from '../auth/sessions.ts'
import type { Config } from '../config.ts'
import type { Db } from '../db/client.ts'
import { aiEvidence, aiJobs, aiRuns, clinicalImages, encounters, files, imageAnalyses, users } from '../db/schema.ts'
import { readStoredBytes, storeBytes } from '../files/storage.ts'
import { badRequest, conflict, HttpError, notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import type { JobService } from '../ai/jobs.ts'
import { sha256 } from '../ai/jobs.ts'
import type { AiProviders } from '../ai/providers.ts'
import type { JobExecutor } from '../ai/routes.ts'
import { activeConsent, getPatientOr404 } from '../patients/service.ts'
import type { AppSettings } from '../settings/schema.ts'
import type { ThermalService } from '../thermal/client.ts'

const IdParams = z.object({ id: z.uuid() })
type ImageRow = typeof clinicalImages.$inferSelect
const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }

export interface ImageRouteDeps {
  db: Db
  config: Config
  settings: AppSettings
  providers: AiProviders
  thermal: ThermalService
  jobs: JobService
  executors: Map<string, JobExecutor>
}

/**
 * Clinical photographs: upload (validated by the image service), storage of
 * the unchanged original plus a metadata-free preview, authorised retrieval
 * through /api/files, and an optional AI description that stays unverified
 * until a doctor reviews it.
 */
export function registerImageRoutes(app: FastifyInstance, deps: ImageRouteDeps) {
  const { db, config, settings, providers, thermal, jobs, executors } = deps
  const limits = settings.uploads.images

  async function imageOr404(me: SessionUser, id: string) {
    const img = await db.query.clinicalImages.findFirst({ where: and(eq(clinicalImages.id, id), eq(clinicalImages.facilityId, me.facilityId)) })
    if (!img) throw notFound('Image')
    return img
  }

  async function toImages(rows: ImageRow[]): Promise<ClinicalImage[]> {
    if (!rows.length) return []
    const ids = rows.map((r) => r.id)
    const decider = alias(users, 'decider')
    const analyses = await db
      .select({ a: imageAnalyses, run: aiRuns, by: decider.fullName })
      .from(imageAnalyses)
      .innerJoin(aiRuns, eq(aiRuns.id, imageAnalyses.runId))
      .leftJoin(decider, eq(decider.id, imageAnalyses.decidedBy))
      .where(inArray(imageAnalyses.imageId, ids))
      .orderBy(desc(imageAnalyses.createdAt))
    const creators = await db.select({ id: users.id, name: users.fullName }).from(users).where(
      inArray(
        users.id,
        rows.map((r) => r.createdBy).filter((x): x is string => !!x),
      ),
    )
    return rows.map((r) => ({
      id: r.id,
      patientId: r.patientId,
      encounterId: r.encounterId,
      fileId: r.fileId,
      previewFileId: r.previewFileId,
      imageType: r.imageType as ClinicalImage['imageType'],
      source: r.source as ClinicalImage['source'],
      bodySite: r.bodySite,
      description: r.description,
      width: r.width,
      height: r.height,
      metadata: r.metadata as ClinicalImage['metadata'],
      dataOrigin: r.dataOrigin,
      createdAt: r.createdAt.toISOString(),
      createdByName: creators.find((c) => c.id === r.createdBy)?.name ?? null,
      analyses: analyses
        .filter((a) => a.a.imageId === r.id)
        .map(
          ({ a, run, by }): ImageAnalysis => ({
            id: a.id,
            jobId: a.jobId,
            result: a.result as ImageAnalysis['result'],
            status: a.status as ImageAnalysis['status'],
            finalText: a.finalText,
            decidedAt: a.decidedAt?.toISOString() ?? null,
            decidedByName: by,
            producedBy: { provider: run.provider, model: run.model, version: run.promptVersion },
            createdAt: a.createdAt.toISOString(),
          }),
        ),
    }))
  }

  app.post('/api/patients/:id/images', { config: { permission: 'images:write' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const patient = await getPatientOr404(db, me.facilityId, id)
    if (!(await activeConsent(db, id, 'clinical_photography'))) throw new HttpError(409, 'consent_required', 'Record the patient’s consent to clinical photographs first')
    const part = await req.file()
    if (!part) throw badRequest('Attach a photograph', [{ path: 'file', message: 'Required' }])
    const raw = Object.fromEntries(Object.entries(part.fields).flatMap(([k, f]) => (k !== 'file' && typeof (f as { value?: unknown }).value === 'string' ? [[k, (f as { value: string }).value || undefined]] : [])))
    const fields = parse(ImageUploadFields, raw)
    const data = await part.toBuffer()
    if (!data.length) throw badRequest('The file is empty')
    if (data.length > limits.maxMb * 1024 * 1024) throw badRequest(`The photograph is larger than ${limits.maxMb} MB`)
    if (fields.encounterId) {
      const e = await db.query.encounters.findFirst({ where: and(eq(encounters.id, fields.encounterId), eq(encounters.patientId, id)) })
      if (!e) throw badRequest('Some fields are invalid', [{ path: 'encounterId', message: 'Not a consultation of this patient' }])
    }
    // The image service validates format and size and makes the preview; rejections (422) pass through.
    const inspected = await thermal.inspectImage(data, { allowed: limits.types, maxPixels: limits.maxPixels, previewMaxSide: limits.previewMaxSide })
    const original = await storeBytes(config.storageDir, data, EXT[inspected.mimeType] ?? '')
    const preview = await storeBytes(config.storageDir, inspected.preview, '.jpg')
    const originalName = path.basename(part.filename || 'photo').slice(0, 120)
    const created = await db.transaction(async (tx) => {
      const base = { facilityId: me.facilityId, patientId: id, encounterId: fields.encounterId ?? null, uploadedBy: me.id }
      const [f] = await tx.insert(files).values({ ...base, kind: 'clinical_image', storageKey: original.storageKey, originalName, mimeType: inspected.mimeType, sizeBytes: original.sizeBytes, sha256: original.sha256 }).returning({ id: files.id })
      const [pf] = await tx.insert(files).values({ ...base, kind: 'clinical_image_preview', storageKey: preview.storageKey, originalName: 'preview.jpg', mimeType: 'image/jpeg', sizeBytes: preview.sizeBytes, sha256: preview.sha256 }).returning({ id: files.id })
      const [img] = await tx
        .insert(clinicalImages)
        .values({
          facilityId: me.facilityId,
          patientId: id,
          encounterId: fields.encounterId ?? null,
          fileId: f!.id,
          previewFileId: pf!.id,
          imageType: fields.imageType,
          source: fields.source,
          bodySite: fields.bodySite ?? null,
          description: fields.description ?? null,
          width: inspected.width,
          height: inspected.height,
          metadata: { format: inspected.format, hadExif: inspected.hadExif, hadGps: inspected.hadGps, originalName },
          dataOrigin: config.dataOrigin,
          createdBy: me.id,
        })
        .returning()
      await audit(tx, req, { action: 'image.upload', entityType: 'clinical_image', entityId: img!.id, patientId: patient.id, details: { imageType: fields.imageType, format: inspected.format, hadGps: inspected.hadGps, encounterId: fields.encounterId ?? null } })
      return img!
    })
    return reply.code(201).send((await toImages([created]))[0])
  })

  app.get('/api/patients/:id/images', { config: { permission: 'patients:read' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    await getPatientOr404(db, me.facilityId, id)
    const rows = await db.select().from(clinicalImages).where(and(eq(clinicalImages.patientId, id), eq(clinicalImages.facilityId, me.facilityId))).orderBy(desc(clinicalImages.createdAt))
    await audit(db, req, { action: 'image.list', entityType: 'patient', entityId: id, patientId: id })
    return { images: await toImages(rows) }
  })

  const analyse: JobExecutor = async (req, _me, job) => {
    const { imageId } = job.input as { imageId: string }
    const img = (await db.query.clinicalImages.findFirst({ where: eq(clinicalImages.id, imageId) }))!
    if (!(await activeConsent(db, img.patientId, 'ai_image_analysis'))) throw new HttpError(409, 'consent_required', 'Record the patient’s consent to AI description of photographs first')
    const d = providers.describer
    if (!d) throw new HttpError(503, 'ai_unavailable', providers.reasons.vision ?? 'AI image analysis is unavailable')
    // The metadata-free preview is what leaves the server, never the original.
    const pf = (await db.query.files.findFirst({ where: eq(files.id, img.previewFileId) }))!
    const bytes = await readStoredBytes(config.storageDir, pf.storageKey)
    return jobs.attempt(
      req,
      job,
      async () => {
        const out = await d.describe(bytes, 'image/jpeg', { imageType: img.imageType, bodySite: img.bodySite })
        return {
          run: { kind: 'image_analysis', provider: d.provider, model: out.model, capability: 'vision', promptVersion: d.promptVersion, inputSha256: pf.sha256, outputSha256: sha256(JSON.stringify(out.result)), inputTokens: out.inputTokens, outputTokens: out.outputTokens, providerRequestId: out.requestId },
          summary: { observations: out.result.observations.length, quality: out.result.quality },
          persist: async (tx, runId) => {
            await tx.update(imageAnalyses).set({ status: 'superseded' }).where(and(eq(imageAnalyses.imageId, imageId), inArray(imageAnalyses.status, ['pending', 'deferred'])))
            const [a] = await tx.insert(imageAnalyses).values({ imageId, jobId: job.id, runId, result: out.result }).returning({ id: imageAnalyses.id })
            await tx.insert(aiEvidence).values({ subjectType: 'image_analysis', subjectId: a!.id, relation: 'supports', sourceType: 'clinical_image', sourceId: img.id, sourceRef: 'IMG', provenance: 'ai_generated', excerpt: `Preview of ${img.imageType}${img.bodySite ? ` (${img.bodySite})` : ''}, ${img.width}×${img.height}`, note: null })
            return a!.id
          },
        }
      },
      () => ({ kind: 'image_analysis', provider: d.provider, model: d.model, capability: 'vision', promptVersion: d.promptVersion, inputSha256: pf.sha256 }),
    )
  }
  executors.set('image_analysis', analyse)

  /** Optional AI description (doctors). Nothing is added to any record without review. */
  app.post('/api/images/:id/analyze', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const { idempotencyKey } = parse(JobRequest, req.body ?? {})
    const img = await imageOr404(me, id)
    if (!(await activeConsent(db, img.patientId, 'ai_image_analysis'))) throw new HttpError(409, 'consent_required', 'Record the patient’s consent to AI description of photographs first')
    if (!providers.describer) throw new HttpError(503, 'ai_unavailable', providers.reasons.vision ?? 'AI image analysis is unavailable')
    const { job, existing } = await jobs.create(req, me, { kind: 'image_analysis', patientId: img.patientId, encounterId: img.encounterId, input: { imageId: id }, idempotencyKey })
    if (existing && job.status !== 'succeeded') throw conflict(job.status === 'running' ? 'This request is already being processed' : 'This request failed earlier. Retry the failed job.', job.status === 'running' ? 'job_running' : 'job_failed')
    if (!existing) await analyse(req, me, job)
    return reply.code(201).send({ image: (await toImages([img]))[0], jobId: job.id })
  })

  /** Failed image jobs, so the client can offer a retry (POST /api/ai-jobs/:id/retry). */
  app.get('/api/images/:id/jobs', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    await imageOr404(me, id)
    const rows = await db.select().from(aiJobs).where(and(eq(aiJobs.kind, 'image_analysis'), eq(aiJobs.facilityId, me.facilityId))).orderBy(desc(aiJobs.createdAt)).limit(50)
    return { jobs: rows.filter((j) => (j.input as { imageId?: string }).imageId === id).map((j) => ({ id: j.id, status: j.status, lastErrorMessage: j.lastErrorMessage, retryable: j.retryable, attempts: j.attempts })) }
  })
}
