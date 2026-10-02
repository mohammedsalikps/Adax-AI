import { type ImageType, InsertIntoNoteRequest, type InsertionSubject, NOTE_SECTION_MAX, type NoteFields, type NoteInsertion, photoNoteText } from '@adaxai/contracts'
import { and, asc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { DbOrTx, Db } from '../db/client.ts'
import { aiDraftItems, aiDrafts, aiRecommendations, aiReviewActions, aiRuns, clinicalFacts, clinicalImages, encounters, imageAnalyses, manaQuestions, noteInsertions, users } from '../db/schema.ts'
import { badRequest, conflict, HttpError, notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { assertOwnDraft, assertWithDoctor, getEncounterOr404, loadEncounter } from './service.ts'

const IdParams = z.object({ id: z.uuid() })
type EncounterRow = typeof encounters.$inferSelect

/** Insertions into one consultation note, with whether each text is still present unchanged. */
export async function loadInsertions(db: DbOrTx, encounterId: string, note: NoteFields): Promise<NoteInsertion[]> {
  const rows = await db
    .select({ i: noteInsertions, by: users.fullName })
    .from(noteInsertions)
    .leftJoin(users, eq(users.id, noteInsertions.insertedBy))
    .where(eq(noteInsertions.encounterId, encounterId))
    .orderBy(asc(noteInsertions.insertedAt))
  return rows.map(({ i, by }) => ({
    id: i.id,
    section: i.section as NoteInsertion['section'],
    text: i.text,
    subjectType: i.subjectType as InsertionSubject,
    subjectId: i.subjectId,
    producedBy: i.producedBy,
    insertedAt: i.insertedAt.toISOString(),
    insertedByName: by,
    retained: (note[i.section as keyof NoteFields] ?? '').includes(i.text),
  }))
}

const produced = (run: typeof aiRuns.$inferSelect | undefined) => (run ? `${run.provider} · ${run.model}${run.promptVersion ? ` · ${run.promptVersion}` : ''}` : null)
const REVIEWED = ['accepted', 'edited']

/**
 * Finds the AI artifact being inserted and checks it belongs to this
 * consultation (or, for a Mana answer or photo description, to this patient)
 * and, where the artifact has a review step, that the doctor accepted it.
 * Returns a "produced by" label (provider, model, prompt or rules version) and
 * the reviewed text that may be inserted (null for a Mana answer, which the
 * doctor edits in the insert dialog).
 */
async function verifySubject(db: Db, e: EncounterRow, type: InsertionSubject, id: string): Promise<{ producedBy: string | null; expected: string | null }> {
  const runOf = async (runId: string | null) => (runId ? await db.query.aiRuns.findFirst({ where: eq(aiRuns.id, runId) }) : undefined)
  const notReviewed = () => conflict('Accept or edit this suggestion before inserting it into the note', 'not_reviewed')
  switch (type) {
    case 'draft_item': {
      const [row] = await db.select({ item: aiDraftItems, draft: aiDrafts }).from(aiDraftItems).innerJoin(aiDrafts, eq(aiDrafts.id, aiDraftItems.draftId)).where(eq(aiDraftItems.id, id))
      if (!row || row.draft.encounterId !== e.id) throw notFound('Note suggestion')
      if (!REVIEWED.includes(row.item.decision)) throw notReviewed()
      return { producedBy: produced(await runOf(row.draft.runId)), expected: row.item.finalText ?? row.item.text }
    }
    case 'fact': {
      const f = await db.query.clinicalFacts.findFirst({ where: eq(clinicalFacts.id, id) })
      if (!f || f.encounterId !== e.id) throw notFound('Extracted fact')
      if (!REVIEWED.includes(f.status)) throw notReviewed()
      return { producedBy: produced(await runOf(f.runId)), expected: f.finalText ?? f.text }
    }
    case 'recommendation': {
      const r = await db.query.aiRecommendations.findFirst({ where: eq(aiRecommendations.id, id) })
      if (!r || r.encounterId !== e.id) throw notFound('Recommendation')
      if (!REVIEWED.includes(r.status)) throw notReviewed()
      return { producedBy: produced(await runOf(r.runId)), expected: r.finalText ?? r.text }
    }
    case 'image_analysis': {
      const [row] = await db.select({ a: imageAnalyses, img: clinicalImages }).from(imageAnalyses).innerJoin(clinicalImages, eq(clinicalImages.id, imageAnalyses.imageId)).where(eq(imageAnalyses.id, id))
      if (!row || row.img.patientId !== e.patientId) throw notFound('Photo description')
      if (!REVIEWED.includes(row.a.status)) throw notReviewed()
      return { producedBy: produced(await runOf(row.a.runId)), expected: photoNoteText(row.img.imageType as ImageType, row.img.bodySite, row.a.finalText ?? (row.a.result as { summary: string }).summary) }
    }
    case 'mana_answer': {
      const q = await db.query.manaQuestions.findFirst({ where: and(eq(manaQuestions.id, id), eq(manaQuestions.facilityId, e.facilityId)) })
      if (!q || q.patientId !== e.patientId) throw notFound('Mana answer')
      const run = await runOf(q.runId)
      return { producedBy: `${run ? `${produced(run)}; ` : ''}record rules ${q.rulesVersion}; text chosen and edited by the doctor`, expected: null }
    }
  }
}

export function registerInsertionRoutes(app: FastifyInstance, { db }: { db: Db }) {
  /**
   * Inserts reviewed AI text into the consultation note on the server, so the
   * note keeps a reference to the AI artifact. Only the authoring doctor,
   * before signing, at the version their editor holds.
   */
  app.post('/api/encounters/:id/insertions', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(InsertIntoNoteRequest, req.body)
    const e = await getEncounterOr404(db, me, id)
    assertOwnDraft(e, me, 'edit')
    await assertWithDoctor(db, e)
    const { producedBy, expected } = await verifySubject(db, e, body.subjectType, body.subjectId)
    const text = body.text.trim()
    if (!text) throw badRequest('Nothing to insert')
    // The note may only claim AI provenance for the text the doctor actually reviewed.
    if (expected !== null && text !== expected.trim()) throw conflict('Only the reviewed text of this suggestion can be inserted. Edit it in the review first, or type your own text into the note.', 'text_mismatch')
    const before = String(e[body.section] ?? '')
    const after = before.trim() ? `${before.trimEnd()}\n${text}` : text
    if (after.length > NOTE_SECTION_MAX[body.section]) throw badRequest(`This would make that section of the note longer than ${NOTE_SECTION_MAX[body.section]} characters. Shorten the text or choose another section.`)

    const dup = await db.query.noteInsertions.findFirst({ where: and(eq(noteInsertions.encounterId, id), eq(noteInsertions.subjectType, body.subjectType), eq(noteInsertions.subjectId, body.subjectId), eq(noteInsertions.section, body.section), eq(noteInsertions.text, text)) })
    if (dup) throw conflict('This text from this suggestion is already in that section of the note', 'already_inserted')

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(encounters)
        .set({ [body.section]: after, version: sql`${encounters.version} + 1`, updatedAt: sql`now()` })
        .where(and(eq(encounters.id, id), eq(encounters.version, body.version), eq(encounters.status, 'in_progress'), eq(encounters[body.section], before)))
        .returning()
      if (!row) return null
      const [ins] = await tx.insert(noteInsertions).values({ encounterId: id, patientId: e.patientId, section: body.section, text, subjectType: body.subjectType, subjectId: body.subjectId, producedBy, insertedBy: me.id }).returning({ id: noteInsertions.id })
      await tx.insert(aiReviewActions).values({ subjectType: body.subjectType, subjectId: body.subjectId, action: 'inserted', text, reason: `Inserted into ${body.section}`, patientId: e.patientId, encounterId: id, actorId: me.id })
      await audit(tx, req, { action: 'encounter.ai_insert', entityType: 'encounter', entityId: id, patientId: e.patientId, details: { insertionId: ins!.id, subjectType: body.subjectType, subjectId: body.subjectId, section: body.section, version: row.version } })
      return row
    })
    if (!updated) {
      const now = await db.query.encounters.findFirst({ where: eq(encounters.id, id) })
      throw new HttpError(409, 'version_conflict', `This consultation was changed elsewhere (now version ${now?.version}). Reload to continue.`)
    }
    return reply.code(201).send(await loadEncounter(db, me, updated))
  })
}
