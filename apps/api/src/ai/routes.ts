import crypto from 'node:crypto'
import path from 'node:path'
import { AiConsentRequest, type AiDraft, type AiRun, CreateTranscriptRequest, DraftDecisionRequest, type EncounterAi, type Transcript, type TranscriptSegment } from '@adaxai/contracts'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { SessionUser } from '../auth/sessions.ts'
import type { Config } from '../config.ts'
import type { Db } from '../db/client.ts'
import { aiDraftItems, aiDrafts, aiRuns, consents, files, patients, transcripts, users } from '../db/schema.ts'
import { getEncounterOr404 } from '../encounters/service.ts'
import { storeBytes } from '../files/storage.ts'
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { activeConsent } from '../patients/service.ts'
import { AiProviderError, type AiProviders, aiStatus } from './providers.ts'
import { pseudonymize, segmentTranscript } from './text.ts'

const IdParams = z.object({ id: z.uuid() })
const AUDIO_TYPES: Record<string, string> = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/mp4': '.m4a',
  'audio/x-m4a': '.m4a',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/wave': '.wav',
}
const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex')

type RunRow = typeof aiRuns.$inferSelect
const toRun = (r: RunRow): AiRun => ({
  id: r.id,
  kind: r.kind as AiRun['kind'],
  status: r.status as AiRun['status'],
  provider: r.provider,
  model: r.model,
  promptVersion: r.promptVersion,
  errorCode: r.errorCode,
  errorMessage: r.errorMessage,
  latencyMs: r.latencyMs,
  createdAt: r.createdAt.toISOString(),
})

export function registerAiRoutes(app: FastifyInstance, deps: { db: Db; config: Config; providers: AiProviders }) {
  const { db, config, providers } = deps

  /** The encounter, if the caller may use AI on it: the authoring doctor, before signing. */
  async function editableEncounter(me: SessionUser, id: string) {
    const e = await getEncounterOr404(db, me, id)
    if (e.doctorId !== me.id) throw forbidden('Only the doctor who started this consultation can use the assistant on it')
    if (e.status !== 'in_progress') throw conflict('This consultation is signed; the assistant is no longer available for it', 'encounter_signed')
    return e
  }

  async function requireConsent(patientId: string, encounterId: string) {
    if (!(await activeConsent(db, patientId, 'ai_recording', encounterId))) {
      throw new HttpError(409, 'consent_required', 'Record the patient’s consent to recording and AI drafting first')
    }
  }

  async function loadAi(me: SessionUser, encounterId: string): Promise<EncounterAi> {
    const e = await getEncounterOr404(db, me, encounterId)
    const consent = await activeConsent(db, e.patientId, 'ai_recording', encounterId)
    const [audioRows, transcriptRows, draftRows, runRows] = await Promise.all([
      db.select().from(files).where(and(eq(files.encounterId, encounterId), eq(files.kind, 'consultation_audio'))).orderBy(asc(files.createdAt)),
      db.select({ t: transcripts, by: users.fullName }).from(transcripts).leftJoin(users, eq(users.id, transcripts.createdBy)).where(eq(transcripts.encounterId, encounterId)).orderBy(asc(transcripts.createdAt)),
      db.select({ d: aiDrafts, r: aiRuns }).from(aiDrafts).innerJoin(aiRuns, eq(aiRuns.id, aiDrafts.runId)).where(eq(aiDrafts.encounterId, encounterId)).orderBy(desc(aiDrafts.createdAt)),
      db.select().from(aiRuns).where(eq(aiRuns.encounterId, encounterId)).orderBy(desc(aiRuns.createdAt)).limit(20),
    ])
    const items = draftRows.length
      ? await db
          .select()
          .from(aiDraftItems)
          .where(
            inArray(
              aiDraftItems.draftId,
              draftRows.map((d) => d.d.id),
            ),
          )
          .orderBy(asc(aiDraftItems.sortOrder))
      : []
    const transcriptsOut: Transcript[] = transcriptRows.map(({ t, by }) => ({
      id: t.id,
      source: t.source as Transcript['source'],
      audioFileId: t.audioFileId,
      segments: t.segments as TranscriptSegment[],
      createdAt: t.createdAt.toISOString(),
      createdByName: by,
    }))
    const drafts: AiDraft[] = draftRows.map(({ d, r }) => ({
      id: d.id,
      transcriptId: d.transcriptId,
      createdAt: d.createdAt.toISOString(),
      run: toRun(r),
      items: items
        .filter((i) => i.draftId === d.id)
        .map((i) => ({
          id: i.id,
          section: i.section as AiDraft['items'][number]['section'],
          text: i.text,
          sourceSegmentIds: i.sourceSegmentIds as string[],
          unsupported: i.unsupported,
          decision: i.decision as AiDraft['items'][number]['decision'],
          finalText: i.finalText,
          decidedAt: i.decidedAt?.toISOString() ?? null,
        })),
    }))
    return {
      consent: { granted: !!consent, scope: (consent?.scope as 'ongoing' | 'encounter' | undefined) ?? null, recordedAt: consent?.recordedAt.toISOString() ?? null },
      status: aiStatus(providers),
      audio: audioRows.map((f) => ({
        fileId: f.id,
        source: f.originalName?.startsWith('recording') ? 'browser_recording' : 'audio_upload',
        mimeType: f.mimeType,
        sizeBytes: f.sizeBytes,
        createdAt: f.createdAt.toISOString(),
        transcriptId: transcriptRows.find((t) => t.t.audioFileId === f.id)?.t.id ?? null,
      })),
      transcripts: transcriptsOut,
      drafts,
      runs: runRows.map(toRun),
    }
  }

  app.get('/api/ai/status', { config: { permission: 'ai:use' } }, async () => aiStatus(providers))

  app.get('/api/encounters/:id/ai', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    return loadAi(me, id)
  })

  /** Consent for this consultation only (the profile page records ongoing consent). */
  app.post('/api/encounters/:id/ai-consent', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const { method } = parse(AiConsentRequest, req.body)
    const e = await editableEncounter(me, id)
    if (await activeConsent(db, e.patientId, 'ai_recording', id)) throw conflict('Consent is already recorded', 'already_granted')
    await db.transaction(async (tx) => {
      const [c] = await tx.insert(consents).values({ patientId: e.patientId, type: 'ai_recording', method, scope: 'encounter', encounterId: id, recordedBy: me.id }).returning({ id: consents.id })
      await audit(tx, req, { action: 'consent.grant', entityType: 'consent', entityId: c!.id, patientId: e.patientId, details: { type: 'ai_recording', scope: 'encounter', method } })
    })
    return reply.code(201).send(await loadAi(me, id))
  })

  app.post('/api/encounters/:id/transcripts', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(CreateTranscriptRequest, req.body)
    const e = await editableEncounter(me, id)
    await requireConsent(e.patientId, id)
    const segments = segmentTranscript(body.text)
    await db.transaction(async (tx) => {
      const [t] = await tx.insert(transcripts).values({ encounterId: id, source: body.source, segments, createdBy: me.id }).returning({ id: transcripts.id })
      await audit(tx, req, { action: 'ai.transcript_create', entityType: 'transcript', entityId: t!.id, patientId: e.patientId, details: { source: body.source, segments: segments.length } })
    })
    return reply.code(201).send(await loadAi(me, id))
  })

  /** Stores consultation audio; transcribes it when speech-to-text is configured. */
  app.post('/api/encounters/:id/audio', { config: { permission: 'ai:use' } }, async (req: FastifyRequest, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const e = await editableEncounter(me, id)
    await requireConsent(e.patientId, id)
    const part = await req.file()
    if (!part) throw badRequest('Attach an audio file', [{ path: 'file', message: 'Required' }])
    const mime = part.mimetype.split(';')[0]!.trim().toLowerCase()
    const ext = AUDIO_TYPES[mime]
    if (!ext) throw badRequest('Unsupported audio format', [{ path: 'file', message: 'Use WebM, OGG, MP3, M4A or WAV audio' }])
    const data = await part.toBuffer()
    if (!data.length) throw badRequest('The audio file is empty', [{ path: 'file', message: 'Empty file' }])
    const recorded = typeof (part.fields.source as { value?: unknown } | undefined)?.value === 'string' && (part.fields.source as { value: string }).value === 'browser_recording'

    const stored = await storeBytes(config.storageDir, data, ext)
    const [file] = await db
      .insert(files)
      .values({
        facilityId: me.facilityId,
        patientId: e.patientId,
        encounterId: id,
        kind: 'consultation_audio',
        storageKey: stored.storageKey,
        originalName: recorded ? `recording${ext}` : path.basename(part.filename || `upload${ext}`).slice(0, 120),
        mimeType: mime,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        uploadedBy: me.id,
      })
      .returning()
    await audit(db, req, { action: 'ai.audio_upload', entityType: 'file', entityId: file!.id, patientId: e.patientId, details: { sizeBytes: stored.sizeBytes, mimeType: mime, source: recorded ? 'browser_recording' : 'audio_upload' } })

    const t = providers.transcriber
    if (!t) return reply.code(201).send({ ...(await loadAi(me, id)), notice: providers.reasons.stt })
    const started = Date.now()
    try {
      const out = await t.transcribe(data, mime, `audio${ext}`)
      const segments = segmentTranscript(out.text)
      await db.transaction(async (tx) => {
        const [run] = await tx
          .insert(aiRuns)
          .values({ encounterId: id, kind: 'stt', provider: t.provider, model: t.model, status: 'succeeded', inputSha256: stored.sha256, outputSha256: sha256(out.text), latencyMs: Date.now() - started, providerRequestId: out.requestId, createdBy: me.id })
          .returning({ id: aiRuns.id })
        await tx.insert(transcripts).values({ encounterId: id, source: recorded ? 'browser_recording' : 'audio_upload', audioFileId: file!.id, sttRunId: run!.id, segments, createdBy: me.id })
        await audit(tx, req, { action: 'ai.stt_run', entityType: 'ai_run', entityId: run!.id, patientId: e.patientId, details: { provider: t.provider, model: t.model, outcome: 'succeeded' } })
      })
      return reply.code(201).send(await loadAi(me, id))
    } catch (err) {
      const pe = err instanceof AiProviderError ? err : new AiProviderError('unknown', 'Transcription failed.')
      const [run] = await db
        .insert(aiRuns)
        .values({ encounterId: id, kind: 'stt', provider: t.provider, model: t.model, status: 'failed', errorCode: pe.code, errorMessage: pe.message, inputSha256: stored.sha256, latencyMs: Date.now() - started, createdBy: me.id })
        .returning({ id: aiRuns.id })
      await audit(db, req, { action: 'ai.stt_run', outcome: 'failure', entityType: 'ai_run', entityId: run!.id, patientId: e.patientId, details: { code: pe.code } })
      // The audio is kept; the doctor can retry by uploading again or type the transcript.
      return reply.code(201).send({ ...(await loadAi(me, id)), notice: `${pe.message} The audio was saved.` })
    }
  })

  /** Generates a structured draft from a transcript. Output is stored as pending suggestions only. */
  app.post('/api/transcripts/:id/drafts', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const t = await db.query.transcripts.findFirst({ where: eq(transcripts.id, id) })
    if (!t) throw notFound('Transcript')
    const e = await editableEncounter(me, t.encounterId)
    await requireConsent(e.patientId, e.id)
    const drafter = providers.drafter
    if (!drafter) throw new HttpError(503, 'ai_unavailable', providers.reasons.llm ?? 'AI drafting is unavailable')

    const patient = (await db.query.patients.findFirst({ where: eq(patients.id, e.patientId) }))!
    const segments = t.segments as TranscriptSegment[]
    // Only the pseudonymised transcript leaves the server.
    const outbound = pseudonymize(segments, patient)
    const started = Date.now()
    try {
      const result = await drafter.draft(outbound)
      const valid = new Set(segments.map((s) => s.id))
      const draftId = await db.transaction(async (tx) => {
        const [run] = await tx
          .insert(aiRuns)
          .values({
            encounterId: e.id,
            kind: 'note_draft',
            provider: drafter.provider,
            model: result.model,
            promptVersion: drafter.promptVersion,
            status: 'succeeded',
            inputSha256: sha256(JSON.stringify(outbound)),
            outputSha256: sha256(JSON.stringify(result.items)),
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: Date.now() - started,
            providerRequestId: result.requestId,
            createdBy: me.id,
          })
          .returning({ id: aiRuns.id })
        const [d] = await tx.insert(aiDrafts).values({ encounterId: e.id, transcriptId: t.id, runId: run!.id }).returning({ id: aiDrafts.id })
        const rows = result.items
          .filter((i) => i.text.trim())
          .map((i, n) => {
            const cited = [...new Set(i.sourceSegmentIds.filter((s) => valid.has(s)))]
            return { draftId: d!.id, section: i.section, text: i.text.trim().slice(0, 8000), sourceSegmentIds: cited, unsupported: cited.length === 0, sortOrder: n }
          })
        if (rows.length) await tx.insert(aiDraftItems).values(rows)
        await audit(tx, req, { action: 'ai.draft_create', entityType: 'ai_draft', entityId: d!.id, patientId: e.patientId, details: { runId: run!.id, model: result.model, promptVersion: drafter.promptVersion, items: rows.length, unsupported: rows.filter((r) => r.unsupported).length } })
        return d!.id
      })
      return reply.code(201).send({ ...(await loadAi(me, e.id)), draftId })
    } catch (err) {
      const pe = err instanceof AiProviderError ? err : new AiProviderError('unknown', 'Drafting failed.')
      const [run] = await db
        .insert(aiRuns)
        .values({ encounterId: e.id, kind: 'note_draft', provider: drafter.provider, model: drafter.model, promptVersion: drafter.promptVersion, status: 'failed', errorCode: pe.code, errorMessage: pe.message, latencyMs: Date.now() - started, createdBy: me.id })
        .returning({ id: aiRuns.id })
      await audit(db, req, { action: 'ai.draft_create', outcome: 'failure', entityType: 'ai_run', entityId: run!.id, patientId: e.patientId, details: { code: pe.code } })
      throw new HttpError(502, `ai_${pe.code}`, `${pe.message}${pe.retryable ? '' : ' You can still write the note yourself.'}`)
    }
  })

  /** Doctor's review decision on one suggestion. Accepted/edited text is then added to the note by the client and saved with the draft. */
  app.post('/api/ai-draft-items/:id/decision', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(DraftDecisionRequest, req.body)
    const [row] = await db.select({ item: aiDraftItems, draft: aiDrafts }).from(aiDraftItems).innerJoin(aiDrafts, eq(aiDrafts.id, aiDraftItems.draftId)).where(eq(aiDraftItems.id, id))
    if (!row) throw notFound('Suggestion')
    const e = await editableEncounter(me, row.draft.encounterId)
    if (row.item.decision !== 'pending') throw conflict('This suggestion has already been reviewed', 'already_decided')
    if (body.decision === 'edited' && !body.text) throw badRequest('Some fields are invalid', [{ path: 'text', message: 'Enter the edited text' }])
    if (body.decision !== 'rejected' && row.item.unsupported && !body.confirmUnsupported) {
      throw new HttpError(409, 'unsupported_confirmation_required', 'This suggestion is not linked to any part of the transcript. Confirm that you have checked it before accepting.')
    }
    const finalText = body.decision === 'rejected' ? null : body.decision === 'edited' ? body.text! : row.item.text
    await db.transaction(async (tx) => {
      await tx.update(aiDraftItems).set({ decision: body.decision, finalText, decidedBy: me.id, decidedAt: new Date() }).where(and(eq(aiDraftItems.id, id), eq(aiDraftItems.decision, 'pending')))
      await audit(tx, req, { action: 'ai.draft_decision', entityType: 'ai_draft_item', entityId: id, patientId: e.patientId, details: { decision: body.decision, section: row.item.section, unsupported: row.item.unsupported } })
    })
    return { ...(await loadAi(me, e.id)), item: { id, section: row.item.section, finalText } }
  })

}
