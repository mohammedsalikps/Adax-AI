import { GenerateConsultDraftRequest, ReviewConsultItemRequest } from '@adaxai/contracts'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { reviewSubject } from '../ai/review.ts'
import { currentUser } from '../auth/plugin.ts'
import type { Db } from '../db/client.ts'
import { consultationDraftItems, consultationDrafts } from '../db/schema.ts'
import { assertWithDoctor } from '../encounters/service.ts'
import { notFound } from '../http/errors.ts'
import { enforceLimit, type RateLimiter } from '../http/rate-limit.ts'
import { parse } from '../http/validate.ts'
import type { AppSettings } from '../settings/schema.ts'
import { type ConsultationService, editableEncounterFor } from './service.ts'

const IdParams = z.object({ id: z.uuid() })

export interface ConsultRouteDeps {
  db: Db
  service: ConsultationService
  limiter: RateLimiter
  settings: AppSettings
}

/**
 * Local AI consultation intelligence. Doctors only (`ai:use`), and only for a consultation they started and have not signed. Every route checks that
 * before it reads anything for the model; the draft itself is made in the background and polled.
 */
export function registerConsultationRoutes(app: FastifyInstance, { db, service, limiter, settings }: ConsultRouteDeps) {
  const limits = settings.security.rateLimits

  const editableEncounter = editableEncounterFor(db)

  app.get('/api/encounters/:id/consultation-ai', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    // `fresh=1`: ask the model server again instead of using what it said a few seconds ago (the doctor pressed "Check again").
    const encounter = await editableEncounter(me, id)
    const ai = await service.get(me, encounter, { fresh: (req.query as { fresh?: string }).fresh === '1' })
    await service.noteViewed(req, me, encounter, ai)
    return ai
  })

  app.post('/api/encounters/:id/consultation-ai/drafts', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(GenerateConsultDraftRequest, req.body)
    await enforceLimit(db, limiter, req, reply, 'ai-step', me.id, limits.aiStepPerUser)
    const e = await editableEncounter(me, id)
    await assertWithDoctor(db, e)
    const { draft, created } = await service.request(req, me, e, body.idempotencyKey)
    // 202: accepted, being made (poll it). 200: the same request again.
    return reply.code(created ? 202 : 200).send(draft)
  })

  app.get('/api/consultation-ai/drafts/:id', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const draft = await service.getDraft(me, id)
    await editableEncounter(me, draft.encounterId)
    return draft
  })

  app.post('/api/consultation-ai/drafts/:id/cancel', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    return service.cancel(req, me, id)
  })

  /** Accept, edit or reject one statement. Nothing is written to the note, the diagnoses or the prescription by this. */
  app.post('/api/consultation-ai/items/:id/review', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(ReviewConsultItemRequest, req.body)
    const [row] = await db.select({ encounterId: consultationDrafts.encounterId }).from(consultationDraftItems).innerJoin(consultationDrafts, eq(consultationDrafts.id, consultationDraftItems.draftId)).where(eq(consultationDraftItems.id, id))
    if (!row) throw notFound('Statement')
    await reviewSubject(db, req, me, 'consultation_item', id, body, editableEncounter)
    return service.get(me, await editableEncounter(me, row.encounterId))
  })
}
