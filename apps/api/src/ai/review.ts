import { CONFIRM_FLAGS, type Evidence, FACT_SECTION, type FactCategory, type ReviewRequest } from '@adaxai/contracts'
import { and, asc, eq, inArray } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { audit } from '../audit/audit.ts'
import type { SessionUser } from '../auth/sessions.ts'
import type { Db, DbOrTx } from '../db/client.ts'
import { aiDraftItems, aiDrafts, aiEvidence, aiRecommendations, aiReviewActions, clinicalFacts, clinicalImages, encounters, imageAnalyses } from '../db/schema.ts'
import { badRequest, conflict, HttpError, notFound } from '../http/errors.ts'
import { CLINICIAN_SIDE, loadSegments, PATIENT_SIDE } from './transcripts.ts'

export type SubjectType = 'fact' | 'recommendation' | 'draft_item' | 'image_analysis'

export async function loadEvidence(db: DbOrTx, subjectIds: string[]): Promise<Map<string, Evidence[]>> {
  const out = new Map<string, Evidence[]>()
  if (!subjectIds.length) return out
  const rows = await db.select().from(aiEvidence).where(inArray(aiEvidence.subjectId, subjectIds)).orderBy(asc(aiEvidence.createdAt))
  for (const r of rows) {
    const list = out.get(r.subjectId) ?? []
    list.push({ id: r.id, relation: r.relation as Evidence['relation'], sourceType: r.sourceType, sourceId: r.sourceId, sourceRef: r.sourceRef, provenance: r.provenance, excerpt: r.excerpt, note: r.note })
    out.set(r.subjectId, list)
  }
  return out
}

interface Loaded {
  status: string
  text: string
  patientId: string
  encounterId: string | null
  /** Why accepting needs explicit confirmation, if it does. */
  confirmReason: string | null
  /** Note section the accepted text belongs in (the client inserts it; null: none). */
  section: string | null
}

async function load(db: Db, type: SubjectType, id: string, facilityId: string): Promise<Loaded> {
  if (type === 'fact') {
    const [f] = await db.select({ f: clinicalFacts, facility: encounters.facilityId }).from(clinicalFacts).innerJoin(encounters, eq(encounters.id, clinicalFacts.encounterId)).where(eq(clinicalFacts.id, id))
    if (!f || f.facility !== facilityId) throw notFound('Extracted fact')
    const flags = (f.f.flags as string[]).filter((x) => (CONFIRM_FLAGS as string[]).includes(x))
    // Who said it can change after a point was found (the doctor assigns speakers line by line): a point that says "the patient said" about a
    // line that is now marked as the doctor's (or the reverse) is stale, and is not confirmed without the doctor's explicit tick.
    let staleSpeaker: string | null = null
    const side = f.f.attribution
    if (side === 'patient_reported' || side === 'clinician_stated') {
      const refs = (await db.select({ ref: aiEvidence.sourceRef }).from(aiEvidence).where(and(eq(aiEvidence.subjectId, id), eq(aiEvidence.sourceType, 'transcript_segment'), eq(aiEvidence.relation, 'supports')))).map((r) => r.ref)
      const lines = ((await loadSegments(db, [f.f.transcriptId])).get(f.f.transcriptId) ?? []).filter((x) => refs.includes(x.id) && x.speaker)
      const contradicting = lines.find((x) => (side === 'patient_reported' ? CLINICIAN_SIDE.has(x.speaker!) : PATIENT_SIDE.has(x.speaker!)))
      if (contradicting) staleSpeaker = `This point says the ${side === 'patient_reported' ? 'patient' : 'doctor'} said it, but its source line ${contradicting.id} is now marked as ${contradicting.speaker}. Confirm that you have checked who said it.`
    }
    const reason = [flags.length ? `This fact is flagged (${flags.join(', ').replace(/_/g, ' ')}). Confirm that you have checked it against the conversation and the record.` : null, staleSpeaker].filter(Boolean).join(' ')
    return { status: f.f.status, text: f.f.text, patientId: f.f.patientId, encounterId: f.f.encounterId, confirmReason: reason || null, section: FACT_SECTION[f.f.category as FactCategory] }
  }
  if (type === 'recommendation') {
    const [r] = await db.select({ r: aiRecommendations, facility: encounters.facilityId }).from(aiRecommendations).innerJoin(encounters, eq(encounters.id, aiRecommendations.encounterId)).where(eq(aiRecommendations.id, id))
    if (!r || r.facility !== facilityId) throw notFound('Recommendation')
    return { status: r.r.status, text: r.r.text, patientId: r.r.patientId, encounterId: r.r.encounterId, confirmReason: r.r.unsupported ? 'None of the data this suggestion cites could be verified. Confirm that you have checked it.' : null, section: null }
  }
  if (type === 'draft_item') {
    const [r] = await db.select({ i: aiDraftItems, e: encounters }).from(aiDraftItems).innerJoin(aiDrafts, eq(aiDrafts.id, aiDraftItems.draftId)).innerJoin(encounters, eq(encounters.id, aiDrafts.encounterId)).where(eq(aiDraftItems.id, id))
    if (!r || r.e.facilityId !== facilityId) throw notFound('Suggestion')
    return { status: r.i.decision, text: r.i.text, patientId: r.e.patientId, encounterId: r.e.id, confirmReason: r.i.unsupported ? 'This suggestion is not linked to any part of the transcript. Confirm that you have checked it before accepting.' : null, section: r.i.section }
  }
  const [a] = await db.select({ a: imageAnalyses, img: clinicalImages }).from(imageAnalyses).innerJoin(clinicalImages, eq(clinicalImages.id, imageAnalyses.imageId)).where(eq(imageAnalyses.id, id))
  if (!a || a.img.facilityId !== facilityId) throw notFound('Image analysis')
  const result = a.a.result as { summary: string; quality: string }
  return { status: a.a.status, text: result.summary, patientId: a.img.patientId, encounterId: a.img.encounterId, confirmReason: result.quality === 'inadequate' ? 'The AI rated this image as inadequate. Confirm that you have checked the description against the image.' : null, section: 'examination' }
}

/**
 * Records a doctor's decision on an AI output. Only pending or deferred items
 * can be decided; flagged or unsupported items need explicit confirmation to
 * be accepted. The decision and the review history are written together.
 */
export async function reviewSubject(
  db: Db,
  req: FastifyRequest,
  me: SessionUser,
  type: SubjectType,
  id: string,
  body: ReviewRequest,
  editableEncounter: (me: SessionUser, id: string) => Promise<typeof encounters.$inferSelect>,
): Promise<{ encounterId: string | null; item: { id: string; type: SubjectType; section: string | null; finalText: string | null; action: string } }> {
  const s = await load(db, type, id, me.facilityId)
  // Outputs of a consultation are reviewed by its doctor while it is open; image analyses by any doctor.
  if (type !== 'image_analysis' && s.encounterId) await editableEncounter(me, s.encounterId)
  if (s.status !== 'pending' && s.status !== 'deferred') throw conflict(s.status === 'superseded' ? 'This item was replaced by a newer run' : 'This item has already been reviewed', 'already_decided')
  if (body.action === 'edited' && !body.text) throw badRequest('Some fields are invalid', [{ path: 'text', message: 'Enter the edited text' }])
  if ((body.action === 'accepted' || body.action === 'edited') && s.confirmReason && !body.confirmFlags) {
    throw new HttpError(409, type === 'draft_item' ? 'unsupported_confirmation_required' : 'confirmation_required', s.confirmReason)
  }
  const finalText = body.action === 'accepted' ? s.text : body.action === 'edited' ? body.text! : null
  const decided = { decidedBy: me.id, decidedAt: new Date() }
  await db.transaction(async (tx) => {
    const n =
      type === 'fact'
        ? await tx
            .update(clinicalFacts)
            .set({ status: body.action, finalText, ...decided })
            .where(and(eq(clinicalFacts.id, id), inArray(clinicalFacts.status, ['pending', 'deferred'])))
            .returning({ id: clinicalFacts.id })
        : type === 'recommendation'
          ? await tx
              .update(aiRecommendations)
              .set({ status: body.action, finalText, ...decided })
              .where(and(eq(aiRecommendations.id, id), inArray(aiRecommendations.status, ['pending', 'deferred'])))
              .returning({ id: aiRecommendations.id })
          : type === 'draft_item'
            ? await tx
                .update(aiDraftItems)
                .set({ decision: body.action, finalText, ...decided })
                .where(and(eq(aiDraftItems.id, id), inArray(aiDraftItems.decision, ['pending', 'deferred'])))
                .returning({ id: aiDraftItems.id })
            : await tx
                .update(imageAnalyses)
                .set({ status: body.action, finalText, ...decided })
                .where(and(eq(imageAnalyses.id, id), inArray(imageAnalyses.status, ['pending', 'deferred'])))
                .returning({ id: imageAnalyses.id })
    if (!n.length) throw conflict('This item has already been reviewed', 'already_decided')
    await tx.insert(aiReviewActions).values({ subjectType: type, subjectId: id, action: body.action, text: finalText, reason: body.reason ?? null, patientId: s.patientId, encounterId: s.encounterId, actorId: me.id })
    await audit(tx, req, { action: type === 'draft_item' ? 'ai.draft_decision' : 'ai.review', entityType: type === 'draft_item' ? 'ai_draft_item' : type, entityId: id, patientId: s.patientId, details: { decision: body.action, type, confirmed: !!body.confirmFlags, encounterId: s.encounterId } })
  })
  return { encounterId: s.encounterId, item: { id, type, section: body.action === 'accepted' || body.action === 'edited' ? s.section : null, finalText, action: body.action } }
}
