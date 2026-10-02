import path from 'node:path'
import {
  AiConsentRequest,
  type AiDraft,
  CONSENT_VERSIONS,
  CreateTranscriptRequest,
  DraftDecisionRequest,
  type EncounterAi,
  JobRequest,
  ReviewRequest,
  type Transcript,
} from '@adaxai/contracts'
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { SessionUser } from '../auth/sessions.ts'
import type { Config } from '../config.ts'
import type { Db } from '../db/client.ts'
import {
  aiDraftItems,
  aiDrafts,
  aiEvidence,
  aiJobs,
  aiRecommendations,
  aiReviewActions,
  aiRuns,
  auditEvents,
  clinicalFacts,
  consents,
  files,
  patients,
  transcripts,
  users,
} from '../db/schema.ts'
import { getEncounterOr404 } from '../encounters/service.ts'
import { readStoredBytes, storeBytes } from '../files/storage.ts'
import { readUpload } from '../files/upload.ts'
import { badRequest, conflict, forbidden, HttpError, notFound } from '../http/errors.ts'
import { parse } from '../http/validate.ts'
import { activeConsent } from '../patients/service.ts'
import type { RoutingRulesSource } from '../settings/load.ts'
import type { AppSettings } from '../settings/schema.ts'
import { compareFacts, COMPARE_RULES_VERSION, type EvidenceOut } from './compare.ts'
import { buildPatientContext, formatContext } from './context.ts'
import { type JobService, loadJobs, sha256, toRun } from './jobs.ts'
import { type AiProviders, aiStatus } from './providers.ts'
import { loadEvidence, reviewSubject } from './review.ts'
import { SAFETY_RULES_VERSION, safetyChecks } from './safety.ts'
import { formatTranscript } from './anthropic.ts'
import { appendSegments, loadSegments } from './transcripts.ts'
import { pseudonymize, segmentTranscript } from './text.ts'

const IdParams = z.object({ id: z.uuid() })
const AUDIO_EXT: Record<string, string> = {
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

type JobRow = typeof aiJobs.$inferSelect
export type JobExecutor = (req: FastifyRequest, me: SessionUser, job: JobRow) => Promise<unknown>

export interface AiRouteDeps {
  db: Db
  config: Config
  providers: AiProviders
  settings: AppSettings
  routing: RoutingRulesSource
  jobs: JobService
  /** Executors by job kind, shared with other modules (images) for retries. */
  executors: Map<string, JobExecutor>
}

const evidenceValues = (subjectType: string, subjectId: string, ev: EvidenceOut[]) => ev.map((e) => ({ subjectType, subjectId, relation: e.relation, sourceType: e.sourceType, sourceId: e.sourceId, sourceRef: e.sourceRef, provenance: e.provenance, excerpt: e.excerpt.slice(0, 2000), note: e.note }))

export function registerAiRoutes(app: FastifyInstance, deps: AiRouteDeps) {
  const { db, config, providers, settings, routing, jobs, executors } = deps

  /** The encounter, if the caller may use AI on it: the authoring doctor, before signing. */
  async function editableEncounter(me: SessionUser, id: string) {
    const e = await getEncounterOr404(db, me, id)
    if (e.doctorId !== me.id) throw forbidden('Only the doctor who started this consultation can use the assistant on it')
    if (e.status !== 'in_progress') throw conflict('This consultation is signed; the assistant is no longer available for it', 'encounter_signed')
    return e
  }

  async function requireConsent(patientId: string, encounterId: string, needsCurrent = false) {
    const c = await activeConsent(db, patientId, 'ai_recording', encounterId)
    if (!c) throw new HttpError(409, 'consent_required', 'Record the patient’s consent to recording and AI assistance first')
    if (needsCurrent && c.version !== CONSENT_VERSIONS.ai_recording) {
      throw new HttpError(409, 'consent_outdated', 'This step also uses the patient’s record. The patient agreed to an earlier consent wording; read the current wording and record consent again.')
    }
    return c
  }

  async function transcriptOr404(me: SessionUser, id: string) {
    const t = await db.query.transcripts.findFirst({ where: eq(transcripts.id, id) })
    if (!t) throw notFound('Transcript')
    await getEncounterOr404(db, me, t.encounterId) // facility check
    return t
  }

  async function loadAi(me: SessionUser, encounterId: string): Promise<EncounterAi> {
    const e = await getEncounterOr404(db, me, encounterId)
    const consent = await activeConsent(db, e.patientId, 'ai_recording', encounterId)
    const [audioRows, transcriptRows, draftRows, runRows] = await Promise.all([
      db
        .select()
        .from(files)
        .where(and(eq(files.encounterId, encounterId), eq(files.kind, 'consultation_audio'), isNull(files.deletedAt), sql`coalesce(${files.originalName}, '') not like 'live-chunk-%'`))
        .orderBy(asc(files.createdAt)),
      db.select({ t: transcripts, by: users.fullName }).from(transcripts).leftJoin(users, eq(users.id, transcripts.createdBy)).where(eq(transcripts.encounterId, encounterId)).orderBy(asc(transcripts.createdAt)),
      db.select({ d: aiDrafts, r: aiRuns }).from(aiDrafts).innerJoin(aiRuns, eq(aiRuns.id, aiDrafts.runId)).where(eq(aiDrafts.encounterId, encounterId)).orderBy(desc(aiDrafts.createdAt)),
      db.select().from(aiRuns).where(eq(aiRuns.encounterId, encounterId)).orderBy(desc(aiRuns.createdAt)).limit(30),
    ])
    const segs = await loadSegments(
      db,
      transcriptRows.map((t) => t.t.id),
    )
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
      status: t.status as Transcript['status'],
      audioFileId: t.audioFileId,
      segments: segs.get(t.id) ?? [],
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
    const factRows = await db.select().from(clinicalFacts).where(and(eq(clinicalFacts.encounterId, encounterId), ne(clinicalFacts.status, 'superseded'))).orderBy(asc(clinicalFacts.createdAt), asc(clinicalFacts.sortOrder))
    const recRows = await db
      .select({ r: aiRecommendations, run: aiRuns })
      .from(aiRecommendations)
      .innerJoin(aiRuns, eq(aiRuns.id, aiRecommendations.runId))
      .where(and(eq(aiRecommendations.encounterId, encounterId), ne(aiRecommendations.status, 'superseded')))
      .orderBy(asc(aiRecommendations.createdAt), asc(aiRecommendations.sortOrder))
    const evidence = await loadEvidence(db, [...factRows.map((f) => f.id), ...recRows.map((r) => r.r.id)])
    const jobList = await loadJobs(db, { encounterId })
    const reviews = await db
      .select({ a: aiReviewActions, by: users.fullName })
      .from(aiReviewActions)
      .leftJoin(users, eq(users.id, aiReviewActions.actorId))
      .where(eq(aiReviewActions.encounterId, encounterId))
      .orderBy(desc(aiReviewActions.createdAt))
      .limit(200)
    const entityIds = [...jobList.map((j) => j.id), ...transcriptRows.map((t) => t.t.id), ...drafts.map((d) => d.id), ...items.map((i) => i.id), ...factRows.map((f) => f.id), ...recRows.map((r) => r.r.id), ...runRows.map((r) => r.id)]
    const auditRows = await db
      .select({ a: auditEvents, by: users.fullName })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(and(eq(auditEvents.patientId, e.patientId), sql`(${auditEvents.action} like 'ai.%' or ${auditEvents.action} = 'consent.grant')`, or(entityIds.length ? inArray(auditEvents.entityId, entityIds) : sql`false`, sql`${auditEvents.details}->>'encounterId' = ${encounterId}`)))
      .orderBy(desc(auditEvents.occurredAt))
      .limit(100)
    return {
      consent: {
        granted: !!consent,
        scope: (consent?.scope as 'ongoing' | 'encounter' | undefined) ?? null,
        recordedAt: consent?.recordedAt.toISOString() ?? null,
        version: consent?.version ?? null,
        current: consent?.version === CONSENT_VERSIONS.ai_recording,
      },
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
      jobs: jobList,
      facts: factRows.map((f) => ({
        id: f.id,
        jobId: f.jobId,
        transcriptId: f.transcriptId,
        category: f.category as EncounterAi['facts'][number]['category'],
        text: f.text,
        attribution: f.attribution as EncounterAi['facts'][number]['attribution'],
        certainty: f.certainty as 'stated' | 'uncertain',
        uncertaintyReason: f.uncertaintyReason,
        negated: f.negated,
        attributes: f.attributes as Record<string, unknown>,
        flags: f.flags as string[],
        status: f.status as EncounterAi['facts'][number]['status'],
        finalText: f.finalText,
        decidedAt: f.decidedAt?.toISOString() ?? null,
        evidence: evidence.get(f.id) ?? [],
      })),
      recommendations: recRows.map(({ r, run }) => ({
        id: r.id,
        jobId: r.jobId,
        source: r.source as 'rules' | 'llm',
        kind: r.kind,
        urgency: r.urgency as 'routine' | 'attention',
        text: r.text,
        rationale: r.rationale,
        instruction: r.instruction,
        missingInformation: r.missingInformation as { text: string }[],
        unsupported: r.unsupported,
        status: r.status as EncounterAi['recommendations'][number]['status'],
        finalText: r.finalText,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        producedBy: { provider: run.provider, model: run.model, version: run.promptVersion },
        evidence: evidence.get(r.id) ?? [],
      })),
      reviewActions: reviews.map(({ a, by }) => ({ id: a.id, subjectType: a.subjectType, subjectId: a.subjectId, action: a.action, text: a.text, reason: a.reason, actorName: by, createdAt: a.createdAt.toISOString() })),
      audit: auditRows.map(({ a, by }) => ({ id: String(a.id), action: a.action, outcome: a.outcome, actorName: by, occurredAt: a.occurredAt.toISOString() })),
    }
  }

  // -------------------------------------------------------------------------
  // Job executors. Each re-checks its preconditions, so a retry is as safe as
  // the first attempt.
  // -------------------------------------------------------------------------

  const transcription: JobExecutor = async (req, me, job) => {
    const input = job.input as { fileId: string; transcriptId: string | null; chunkIndex: number | null; source: 'audio_upload' | 'browser_recording' }
    const e = await editableEncounter(me, job.encounterId!)
    await requireConsent(e.patientId, e.id)
    const t = providers.transcriber
    if (!t) throw new HttpError(503, 'stt_unavailable', providers.reasons.stt ?? 'Speech-to-text is unavailable')
    const file = (await db.query.files.findFirst({ where: and(eq(files.id, input.fileId), eq(files.encounterId, e.id)) }))!
    if (file.deletedAt) throw conflict('The recording has been deleted under the retention policy', 'audio_deleted')
    const data = await readStoredBytes(config.storageDir, file.storageKey)
    return jobs.attempt(
      req,
      job,
      async () => {
        const out = await t.transcribe(data, file.mimeType, `audio${AUDIO_EXT[file.mimeType] ?? ''}`)
        const segments = segmentTranscript(out.text)
        return {
          run: { kind: 'stt', provider: t.provider, model: t.model, capability: 'stt', promptVersion: null, inputSha256: file.sha256, outputSha256: sha256(out.text), providerRequestId: out.requestId },
          summary: { segments: segments.length, ...(input.chunkIndex !== null && { chunkIndex: input.chunkIndex }) },
          persist: async (tx, runId) => {
            const toNew = segments.map((s) => ({ speaker: s.speaker, speakerSource: 'typed_label' as const, text: s.text, chunkIndex: input.chunkIndex }))
            if (input.transcriptId) {
              await appendSegments(tx, input.transcriptId, toNew)
              return input.transcriptId
            }
            const [tr] = await tx.insert(transcripts).values({ encounterId: e.id, source: input.source, audioFileId: file.id, sttRunId: runId, status: 'final', createdBy: me.id }).returning({ id: transcripts.id })
            await appendSegments(tx, tr!.id, toNew)
            return tr!.id
          },
        }
      },
      () => ({ kind: 'stt', provider: t.provider, model: t.model, capability: 'stt', promptVersion: null, inputSha256: file.sha256 }),
    )
  }

  const noteDraft: JobExecutor = async (req, me, job) => {
    const { transcriptId } = job.input as { transcriptId: string }
    const e = await editableEncounter(me, job.encounterId!)
    await requireConsent(e.patientId, e.id)
    const drafter = providers.drafter
    if (!drafter) throw new HttpError(503, 'ai_unavailable', providers.reasons.llm ?? 'AI drafting is unavailable')
    const patient = (await db.query.patients.findFirst({ where: eq(patients.id, e.patientId) }))!
    const segments = (await loadSegments(db, [transcriptId])).get(transcriptId)!
    if (!segments.length) throw badRequest('The transcript is empty')
    // Only the pseudonymised transcript leaves the server.
    const outbound = pseudonymize(segments, patient)
    const inputSha = sha256(JSON.stringify(outbound))
    return jobs.attempt(
      req,
      job,
      async () => {
        const result = await drafter.draft(outbound)
        const valid = new Set(segments.map((s) => s.id))
        const rows = result.items
          .filter((i) => i.text.trim())
          .map((i, n) => {
            const cited = [...new Set(i.sourceSegmentIds.filter((s) => valid.has(s)))]
            return { section: i.section, text: i.text.trim().slice(0, 8000), sourceSegmentIds: cited, unsupported: cited.length === 0, sortOrder: n }
          })
        return {
          run: { kind: 'note_draft', provider: drafter.provider, model: result.model, capability: 'llm', promptVersion: drafter.promptVersion, inputSha256: inputSha, outputSha256: sha256(JSON.stringify(result.items)), inputTokens: result.inputTokens, outputTokens: result.outputTokens, providerRequestId: result.requestId },
          summary: { items: rows.length, unsupported: rows.filter((r) => r.unsupported).length },
          persist: async (tx, runId) => {
            // Earlier undecided suggestions for this transcript are superseded, not deleted.
            const earlier = await tx.select({ id: aiDrafts.id }).from(aiDrafts).where(eq(aiDrafts.transcriptId, transcriptId))
            if (earlier.length)
              await tx
                .update(aiDraftItems)
                .set({ decision: 'superseded' })
                .where(
                  and(
                    inArray(
                      aiDraftItems.draftId,
                      earlier.map((d) => d.id),
                    ),
                    inArray(aiDraftItems.decision, ['pending', 'deferred']),
                  ),
                )
            const [d] = await tx.insert(aiDrafts).values({ encounterId: e.id, transcriptId, runId }).returning({ id: aiDrafts.id })
            if (rows.length) await tx.insert(aiDraftItems).values(rows.map((r) => ({ ...r, draftId: d!.id })))
            return d!.id
          },
        }
      },
      () => ({ kind: 'note_draft', provider: drafter.provider, model: drafter.model, capability: 'llm', promptVersion: drafter.promptVersion, inputSha256: inputSha }),
    )
  }

  const extraction: JobExecutor = async (req, me, job) => {
    const { transcriptId } = job.input as { transcriptId: string }
    const e = await editableEncounter(me, job.encounterId!)
    await requireConsent(e.patientId, e.id)
    const extractor = providers.extractor
    if (!extractor) throw new HttpError(503, 'ai_unavailable', providers.reasons.llm ?? 'AI extraction is unavailable')
    const segments = (await loadSegments(db, [transcriptId])).get(transcriptId)!
    if (!segments.length) throw badRequest('The transcript is empty')
    const ctx = await buildPatientContext(db, e, settings.ai.context)
    const outbound = pseudonymize(segments, ctx.patient)
    const inputSha = sha256(JSON.stringify(outbound))
    return jobs.attempt(
      req,
      job,
      async () => {
        const result = await extractor.extract(outbound)
        // Deterministic checks against the transcript and the record (not the model).
        const compared = compareFacts(
          result.facts.filter((f) => f.text.trim()),
          segments,
          ctx,
          settings.safety,
        )
        return {
          run: { kind: 'extraction', provider: extractor.provider, model: result.model, capability: 'llm', promptVersion: extractor.promptVersion, inputSha256: inputSha, outputSha256: sha256(JSON.stringify(result.facts)), inputTokens: result.inputTokens, outputTokens: result.outputTokens, providerRequestId: result.requestId },
          summary: { facts: compared.length, flagged: compared.filter((c) => c.flags.length).length, comparison: COMPARE_RULES_VERSION },
          persist: async (tx, runId) => {
            await tx.update(clinicalFacts).set({ status: 'superseded' }).where(and(eq(clinicalFacts.transcriptId, transcriptId), inArray(clinicalFacts.status, ['pending', 'deferred'])))
            for (const [n, c] of compared.entries()) {
              const f = c.fact
              const attributes = Object.fromEntries(Object.entries(f.details).filter(([, v]) => v !== null))
              const [row] = await tx
                .insert(clinicalFacts)
                .values({ jobId: job.id, runId, transcriptId, encounterId: e.id, patientId: e.patientId, category: f.category, text: f.text.trim().slice(0, 2000), attribution: f.attribution, certainty: f.certainty, uncertaintyReason: f.uncertaintyReason, negated: f.negated, attributes, flags: c.flags, sortOrder: n })
                .returning({ id: clinicalFacts.id })
              if (c.evidence.length) await tx.insert(aiEvidence).values(evidenceValues('fact', row!.id, c.evidence))
            }
            return compared.length
          },
        }
      },
      () => ({ kind: 'extraction', provider: extractor.provider, model: extractor.model, capability: 'llm', promptVersion: extractor.promptVersion, inputSha256: inputSha }),
    )
  }

  async function latestTranscriptId(encounterId: string): Promise<string | null> {
    const [t] = await db.select({ id: transcripts.id }).from(transcripts).where(eq(transcripts.encounterId, encounterId)).orderBy(desc(transcripts.createdAt)).limit(1)
    return t?.id ?? null
  }

  const safetyCheck: JobExecutor = async (req, me, job) => {
    const { transcriptId } = job.input as { transcriptId: string | null }
    const e = await editableEncounter(me, job.encounterId!)
    const ctx = await buildPatientContext(db, e, settings.ai.context)
    const segments = transcriptId ? (await loadSegments(db, [transcriptId])).get(transcriptId)! : []
    const rules = routing.current()
    const facts = await db.select().from(clinicalFacts).where(and(eq(clinicalFacts.encounterId, e.id), inArray(clinicalFacts.status, ['pending', 'deferred', 'accepted', 'edited'])))
    const factEvidence = await loadEvidence(
      db,
      facts.map((f) => f.id),
    )
    const factInput = facts.map((f) => ({ text: f.finalText ?? f.text, flags: f.flags as string[], evidence: (factEvidence.get(f.id) ?? []).map((x) => ({ ...x, provenance: x.provenance as EvidenceOut['provenance'] })) }))
    const inputSha = sha256(JSON.stringify({ items: ctx.items, segments, facts: factInput }))
    return jobs.attempt(
      req,
      job,
      async () => {
        const recs = safetyChecks(ctx, segments, factInput, settings.safety, rules)
        return {
          run: { kind: 'safety_check', provider: 'adaxai-rules', model: SAFETY_RULES_VERSION, capability: 'rules', promptVersion: rules.version, inputSha256: inputSha, outputSha256: sha256(JSON.stringify(recs)) },
          summary: { recommendations: recs.length, attention: recs.filter((r) => r.urgency === 'attention').length },
          persist: async (tx, runId) => {
            await tx.update(aiRecommendations).set({ status: 'superseded' }).where(and(eq(aiRecommendations.encounterId, e.id), eq(aiRecommendations.source, 'rules'), inArray(aiRecommendations.status, ['pending', 'deferred'])))
            for (const [n, r] of recs.entries()) {
              const [row] = await tx
                .insert(aiRecommendations)
                .values({ jobId: job.id, runId, encounterId: e.id, patientId: e.patientId, source: 'rules', kind: r.kind, urgency: r.urgency, text: r.text, rationale: r.rationale, instruction: r.instruction, missingInformation: r.missingInformation, unsupported: false, sortOrder: n })
                .returning({ id: aiRecommendations.id })
              if (r.evidence.length) await tx.insert(aiEvidence).values(evidenceValues('recommendation', row!.id, r.evidence))
            }
            return recs.length
          },
        }
      },
      () => ({ kind: 'safety_check', provider: 'adaxai-rules', model: SAFETY_RULES_VERSION, capability: 'rules', promptVersion: rules.version, inputSha256: inputSha }),
    )
  }

  const recommendations: JobExecutor = async (req, me, job) => {
    const { transcriptId } = job.input as { transcriptId: string | null }
    const e = await editableEncounter(me, job.encounterId!)
    await requireConsent(e.patientId, e.id, true)
    const recommender = providers.recommender
    if (!recommender) throw new HttpError(503, 'ai_unavailable', providers.reasons.llm ?? 'AI recommendations are unavailable')
    const ctx = await buildPatientContext(db, e, settings.ai.context)
    const segments = transcriptId ? pseudonymize((await loadSegments(db, [transcriptId])).get(transcriptId)!, ctx.patient) : []
    const input = { patientLine: `Age band ${ctx.ageBand}, sex ${ctx.patient.sex}`, recordText: formatContext(ctx.items), transcriptText: segments.length ? formatTranscript(segments) : '(no transcript)' }
    const inputSha = sha256(JSON.stringify(input))
    const segById = new Map(segments.map((s) => [s.id, s]))
    const resolve = (ref: string): EvidenceOut | null => {
      const r = ref.replace(/[[\]\s]/g, '')
      const item = ctx.byRef.get(r)
      if (item) return { relation: 'supports', sourceType: item.sourceType, sourceId: item.sourceId, sourceRef: item.ref, provenance: item.provenance, excerpt: item.text, note: null }
      const s = segById.get(r)
      if (s) return { relation: 'supports', sourceType: 'transcript_segment', sourceId: null, sourceRef: s.id, provenance: s.speaker === 'Patient' ? 'patient_reported' : s.speaker === 'Doctor' ? 'clinician_stated' : 'transcript_unlabelled', excerpt: `${s.speaker ? `${s.speaker}: ` : ''}${s.text}`, note: null }
      return null
    }
    return jobs.attempt(
      req,
      job,
      async () => {
        const result = await recommender.recommend(input)
        const recs = result.recommendations
          .filter((r) => r.text.trim())
          .map((r) => {
            const support = r.supportingRefs.map(resolve).filter((x): x is EvidenceOut => !!x)
            const conflicts = r.conflicts.flatMap((c) =>
              c.refs
                .map(resolve)
                .filter((x): x is EvidenceOut => !!x)
                .map((x) => ({ ...x, relation: 'conflicts' as const, note: c.text.slice(0, 500) })),
            )
            return { r, evidence: [...support, ...conflicts], unsupported: support.length === 0 }
          })
        return {
          run: { kind: 'recommendations', provider: recommender.provider, model: result.model, capability: 'llm', promptVersion: recommender.promptVersion, inputSha256: inputSha, outputSha256: sha256(JSON.stringify(result.recommendations)), inputTokens: result.inputTokens, outputTokens: result.outputTokens, providerRequestId: result.requestId },
          summary: { recommendations: recs.length, unsupported: recs.filter((x) => x.unsupported).length, insufficientData: result.insufficientData, ...(result.insufficientDataReason && { insufficientDataReason: result.insufficientDataReason.slice(0, 500) }) },
          persist: async (tx, runId) => {
            await tx.update(aiRecommendations).set({ status: 'superseded' }).where(and(eq(aiRecommendations.encounterId, e.id), eq(aiRecommendations.source, 'llm'), inArray(aiRecommendations.status, ['pending', 'deferred'])))
            for (const [n, { r, evidence, unsupported }] of recs.entries()) {
              const [row] = await tx
                .insert(aiRecommendations)
                .values({ jobId: job.id, runId, encounterId: e.id, patientId: e.patientId, source: 'llm', kind: r.kind, urgency: r.urgency, text: r.text.trim().slice(0, 2000), rationale: r.rationale.trim().slice(0, 2000), missingInformation: r.missingInformation.map((m) => ({ text: m.slice(0, 300) })), unsupported, sortOrder: n })
                .returning({ id: aiRecommendations.id })
              if (evidence.length) await tx.insert(aiEvidence).values(evidenceValues('recommendation', row!.id, evidence))
            }
            return recs.length
          },
        }
      },
      () => ({ kind: 'recommendations', provider: recommender.provider, model: recommender.model, capability: 'llm', promptVersion: recommender.promptVersion, inputSha256: inputSha }),
    )
  }

  executors.set('transcription', transcription)
  executors.set('note_draft', noteDraft)
  executors.set('extraction', extraction)
  executors.set('safety_check', safetyCheck)
  executors.set('recommendations', recommendations)

  /** Creates a job (or finds the one for this idempotency key) and runs it once. */
  async function startJob(req: FastifyRequest, me: SessionUser, o: Parameters<JobService['create']>[2]) {
    const { job, existing } = await jobs.create(req, me, o)
    if (existing) {
      if (job.status === 'running') throw conflict('This request is already being processed', 'job_running')
      if (job.status === 'failed') throw conflict('This request failed earlier. Use “Retry” on the failed job.', 'job_failed')
      return job
    }
    await executors.get(o.kind)!(req, me, job)
    return job
  }

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------

  app.get('/api/ai/status', { config: { permission: 'ai:use' } }, async () => aiStatus(providers))

  app.get('/api/encounters/:id/ai', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const out = await loadAi(me, id)
    // Named outside 'ai.*' so routine reads do not crowd the consultation's AI activity trail.
    const e = await getEncounterOr404(db, me, id)
    await audit(db, req, { action: 'encounter_ai.read', entityType: 'encounter', entityId: id, patientId: e.patientId })
    return out
  })

  /** Consent for this consultation only (the profile page records ongoing consent). */
  app.post('/api/encounters/:id/ai-consent', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const { method } = parse(AiConsentRequest, req.body)
    const e = await editableEncounter(me, id)
    const existing = await activeConsent(db, e.patientId, 'ai_recording', id)
    if (existing?.version === CONSENT_VERSIONS.ai_recording) throw conflict('Consent is already recorded', 'already_granted')
    await db.transaction(async (tx) => {
      const [c] = await tx.insert(consents).values({ patientId: e.patientId, type: 'ai_recording', method, scope: 'encounter', encounterId: id, version: CONSENT_VERSIONS.ai_recording, recordedBy: me.id }).returning({ id: consents.id })
      await audit(tx, req, { action: 'consent.grant', entityType: 'consent', entityId: c!.id, patientId: e.patientId, details: { type: 'ai_recording', scope: 'encounter', method, encounterId: id, version: CONSENT_VERSIONS.ai_recording } })
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
      const [t] = await tx.insert(transcripts).values({ encounterId: id, source: body.source, status: 'final', createdBy: me.id }).returning({ id: transcripts.id })
      await appendSegments(
        tx,
        t!.id,
        segments.map((s) => ({ speaker: s.speaker, speakerSource: 'typed_label', text: s.text })),
      )
      await audit(tx, req, { action: 'ai.transcript_create', entityType: 'transcript', entityId: t!.id, patientId: e.patientId, details: { source: body.source, segments: segments.length, encounterId: id } })
    })
    return reply.code(201).send(await loadAi(me, id))
  })

  async function storeAudio(req: FastifyRequest, me: SessionUser, e: { id: string; patientId: string }, nameFor: (ext: string, original: string | undefined, field: (n: string) => string | undefined) => string) {
    const up = await readUpload(req, 'an audio file')
    const mime = up.mimetype
    const ext = AUDIO_EXT[mime]
    if (!ext || !settings.uploads.audio.types.includes(mime)) throw badRequest('Unsupported audio format', [{ path: 'file', message: 'Use WebM, OGG, MP3, M4A or WAV audio' }])
    const data = up.data
    if (data.length > settings.uploads.audio.maxMb * 1024 * 1024) throw new HttpError(413, 'too_large', `Audio is larger than ${settings.uploads.audio.maxMb} MB`)
    const field = (n: string) => up.fields[n]
    const originalName = nameFor(ext, up.filename, field)
    const stored = await storeBytes(config.storageDir, data, ext)
    const [file] = await db
      .insert(files)
      .values({ facilityId: me.facilityId, patientId: e.patientId, encounterId: e.id, kind: 'consultation_audio', storageKey: stored.storageKey, originalName, mimeType: mime, sizeBytes: stored.sizeBytes, sha256: stored.sha256, uploadedBy: me.id })
      .returning()
    return file!
  }

  /** Stores consultation audio; transcribes it when speech-to-text is configured. */
  app.post('/api/encounters/:id/audio', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const e = await editableEncounter(me, id)
    await requireConsent(e.patientId, id)
    let recorded = false
    const file = await storeAudio(req, me, e, (ext, original, field) => {
      recorded = field('source') === 'browser_recording'
      return recorded ? `recording${ext}` : path.basename(original || `upload${ext}`).slice(0, 120)
    })
    await audit(db, req, { action: 'ai.audio_upload', entityType: 'file', entityId: file.id, patientId: e.patientId, details: { sizeBytes: file.sizeBytes, mimeType: file.mimeType, source: recorded ? 'browser_recording' : 'audio_upload', encounterId: id } })
    if (!providers.transcriber) return reply.code(201).send({ ...(await loadAi(me, id)), notice: providers.reasons.stt })
    try {
      await startJob(req, me, { kind: 'transcription', patientId: e.patientId, encounterId: id, input: { fileId: file.id, transcriptId: null, chunkIndex: null, source: recorded ? 'browser_recording' : 'audio_upload' } })
      return reply.code(201).send(await loadAi(me, id))
    } catch (err) {
      if (!(err instanceof HttpError)) throw err
      // The audio is kept; the doctor can retry the job or type the transcript.
      return reply.code(201).send({ ...(await loadAi(me, id)), notice: `${err.message} The audio was saved.` })
    }
  })

  /** Starts a live (chunked) transcript. Each chunk is transcribed as it arrives. */
  app.post('/api/encounters/:id/live-transcripts', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const e = await editableEncounter(me, id)
    await requireConsent(e.patientId, id)
    if (!providers.transcriber || providers.features?.liveTranscription === false) throw new HttpError(503, 'stt_unavailable', providers.reasons.stt ?? 'Live transcription is switched off.')
    const [t] = await db.insert(transcripts).values({ encounterId: id, source: 'browser_recording', status: 'live', createdBy: me.id }).returning({ id: transcripts.id })
    await audit(db, req, { action: 'ai.live_start', entityType: 'transcript', entityId: t!.id, patientId: e.patientId, details: { encounterId: id } })
    return reply.code(201).send({ ...(await loadAi(me, id)), transcriptId: t!.id })
  })

  app.post('/api/transcripts/:id/chunks', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const t = await transcriptOr404(me, id)
    const e = await editableEncounter(me, t.encounterId)
    await requireConsent(e.patientId, e.id)
    if (t.status !== 'live') throw conflict('This recording has ended', 'transcript_not_live')
    let index = -1
    const file = await storeAudio(req, me, e, (ext, _original, field) => {
      const parsed = z.coerce.number().int().min(0).max(100000).safeParse(field('chunkIndex'))
      if (!parsed.success) throw badRequest('Some fields are invalid', [{ path: 'chunkIndex', message: 'Send chunkIndex before the file' }])
      index = parsed.data
      return `live-chunk-${index}${ext}`
    })
    const chunkIndex = { data: index }
    try {
      await startJob(req, me, { kind: 'transcription', patientId: e.patientId, encounterId: e.id, input: { fileId: file.id, transcriptId: id, chunkIndex: chunkIndex.data, source: 'browser_recording' } })
      return reply.code(201).send(await loadAi(me, e.id))
    } catch (err) {
      if (!(err instanceof HttpError)) throw err
      return reply.code(201).send({ ...(await loadAi(me, e.id)), notice: `Part ${chunkIndex.data + 1}: ${err.message} The audio was saved.` })
    }
  })

  app.post('/api/transcripts/:id/end', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const t = await transcriptOr404(me, id)
    const e = await editableEncounter(me, t.encounterId)
    if (t.status === 'live') {
      await db.update(transcripts).set({ status: 'final', endedAt: new Date() }).where(eq(transcripts.id, id))
      await audit(db, req, { action: 'ai.live_end', entityType: 'transcript', entityId: id, patientId: e.patientId, details: { encounterId: e.id } })
    }
    return loadAi(me, e.id)
  })

  /** Generates a structured note draft from a transcript. Output is stored as pending suggestions only. */
  app.post('/api/transcripts/:id/drafts', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const { idempotencyKey } = parse(JobRequest, req.body ?? {})
    const t = await transcriptOr404(me, id)
    const e = await editableEncounter(me, t.encounterId)
    await requireConsent(e.patientId, e.id)
    if (!providers.drafter) throw new HttpError(503, 'ai_unavailable', providers.reasons.llm ?? 'AI drafting is unavailable')
    const job = await startJob(req, me, { kind: 'note_draft', patientId: e.patientId, encounterId: e.id, input: { transcriptId: id }, idempotencyKey })
    const [d] = await db.select({ id: aiDrafts.id }).from(aiDrafts).innerJoin(aiRuns, eq(aiRuns.id, aiDrafts.runId)).where(eq(aiRuns.jobId, job.id)).limit(1)
    return reply.code(201).send({ ...(await loadAi(me, e.id)), draftId: d?.id ?? null, jobId: job.id })
  })

  /** Extracts structured facts (with transcript evidence and record comparison). */
  app.post('/api/transcripts/:id/extract', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const { idempotencyKey } = parse(JobRequest, req.body ?? {})
    const t = await transcriptOr404(me, id)
    const e = await editableEncounter(me, t.encounterId)
    await requireConsent(e.patientId, e.id)
    if (!providers.extractor) throw new HttpError(503, 'ai_unavailable', providers.reasons.llm ?? 'AI extraction is unavailable')
    const job = await startJob(req, me, { kind: 'extraction', patientId: e.patientId, encounterId: e.id, input: { transcriptId: id }, idempotencyKey })
    return reply.code(201).send({ ...(await loadAi(me, e.id)), jobId: job.id })
  })

  /**
   * Decision support: deterministic safety rules always; language-model
   * recommendations too when configured and requested. A model failure
   * leaves the rule results in place and is reported, never papered over.
   */
  app.post('/api/encounters/:id/recommendations', { config: { permission: 'ai:use' } }, async (req, reply) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(z.object({ includeLlm: z.boolean().default(true), idempotencyKey: z.uuid().optional() }), req.body ?? {})
    const e = await editableEncounter(me, id)
    const transcriptId = await latestTranscriptId(id)
    await startJob(req, me, { kind: 'safety_check', patientId: e.patientId, encounterId: id, input: { transcriptId }, idempotencyKey: body.idempotencyKey })
    let notice: string | null = null
    if (body.includeLlm) {
      if (!providers.recommender) notice = providers.reasons.llm ?? 'AI recommendations are unavailable.'
      else {
        try {
          await requireConsent(e.patientId, id, true)
          await startJob(req, me, { kind: 'recommendations', patientId: e.patientId, encounterId: id, input: { transcriptId } })
        } catch (err) {
          if (!(err instanceof HttpError)) throw err
          notice = `AI recommendations: ${err.message}`
        }
      }
    }
    return reply.code(201).send({ ...(await loadAi(me, id)), notice })
  })

  /** Re-runs a failed job. Its inputs and preconditions are checked again. */
  app.post('/api/ai-jobs/:id/retry', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const job = await db.query.aiJobs.findFirst({ where: and(eq(aiJobs.id, id), eq(aiJobs.facilityId, me.facilityId)) })
    if (!job) throw notFound('AI job')
    if (job.status !== 'failed') throw conflict(job.status === 'running' ? 'This job is still running' : 'This job has already succeeded', 'job_not_failed')
    const run = executors.get(job.kind)
    if (!run) throw badRequest('This job cannot be retried')
    await audit(db, req, { action: 'ai.job_retry', entityType: 'ai_job', entityId: id, patientId: job.patientId, details: { kind: job.kind, attempts: job.attempts } })
    await run(req, me, job)
    const after = (await loadJobs(db, { ids: [id] }))[0]!
    return { job: after, ...(job.encounterId ? { encounter: await loadAi(me, job.encounterId) } : {}) }
  })

  /** Doctor review of any AI output: accept, edit, reject or defer. */
  app.post('/api/ai-review/:type/:id', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { type, id } = parse(z.object({ type: z.enum(['fact', 'recommendation', 'draft_item', 'image_analysis']), id: z.uuid() }), req.params)
    const body = parse(ReviewRequest, req.body)
    const result = await reviewSubject(db, req, me, type, id, body, editableEncounter)
    return { ...(result.encounterId ? await loadAi(me, result.encounterId) : {}), item: result.item }
  })

  /** Earlier endpoint for note-draft items, kept for compatibility. */
  app.post('/api/ai-draft-items/:id/decision', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const { id } = parse(IdParams, req.params)
    const body = parse(DraftDecisionRequest, req.body)
    const result = await reviewSubject(db, req, me, 'draft_item', id, { action: body.decision, ...(body.text !== undefined && { text: body.text }), ...(body.confirmUnsupported !== undefined && { confirmFlags: body.confirmUnsupported }) }, editableEncounter)
    return { ...(await loadAi(me, result.encounterId!)), item: result.item }
  })

  return { loadAi, editableEncounter }
}
