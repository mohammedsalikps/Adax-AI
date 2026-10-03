import type { TranscriptSegment } from '@adaxai/contracts'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { transcriptSegmentSpeakers, transcriptSegments, transcripts } from '../db/schema.ts'

export interface NewSegment {
  speaker: string | null
  speakerSource: 'typed_label' | 'provider' | 'none'
  text: string
  chunkIndex?: number | null
  /** On the recording's timeline (recorded audio only), already offset by the part's own start. */
  startMs?: number | null
  endMs?: number | null
  confidence?: number | null
  language?: string | null
  avgLogprob?: number | null
  noSpeechProb?: number | null
  runId?: string | null
}

/**
 * Appends segments to a transcript, numbering them S{n} after the last one.
 * The transcript row is locked so concurrent chunks cannot reuse a label.
 */
export async function appendSegments(tx: DbOrTx, transcriptId: string, segs: NewSegment[]): Promise<TranscriptSegment[]> {
  if (!segs.length) return []
  await tx.execute(sql`select 1 from ${transcripts} where ${transcripts.id} = ${transcriptId} for update`)
  const [row] = await tx.select({ max: sql<number>`coalesce(max(${transcriptSegments.seq}), 0)::int` }).from(transcriptSegments).where(eq(transcriptSegments.transcriptId, transcriptId))
  let seq = row?.max ?? 0
  const values = segs.map((s) => {
    seq++
    return {
      transcriptId,
      seq,
      label: `S${seq}`,
      speaker: s.speaker,
      speakerSource: s.speaker ? s.speakerSource : 'none',
      text: s.text,
      chunkIndex: s.chunkIndex ?? null,
      startMs: s.startMs ?? null,
      endMs: s.endMs ?? null,
      confidence: s.confidence ?? null,
      language: s.language ?? null,
      avgLogprob: s.avgLogprob ?? null,
      noSpeechProb: s.noSpeechProb ?? null,
      runId: s.runId ?? null,
    }
  })
  await tx.insert(transcriptSegments).values(values)
  return values.map((v) => ({ id: v.label, speaker: v.speaker, text: v.text, chunkIndex: v.chunkIndex }))
}

/**
 * Segments per transcript, in reading order (recorded part, then time, then sequence). The speaker is the doctor's latest assignment if
 * there is one (reviewed metadata: the words themselves never change), otherwise what the line was typed or provided with.
 */
export async function loadSegments(db: DbOrTx, transcriptIds: string[]): Promise<Map<string, TranscriptSegment[]>> {
  const out = new Map<string, TranscriptSegment[]>(transcriptIds.map((id) => [id, []]))
  if (!transcriptIds.length) return out
  const rows = await db
    .select()
    .from(transcriptSegments)
    .where(inArray(transcriptSegments.transcriptId, transcriptIds))
    .orderBy(asc(transcriptSegments.transcriptId), sql`${transcriptSegments.chunkIndex} asc nulls first`, sql`${transcriptSegments.startMs} asc nulls first`, asc(transcriptSegments.seq))
  const latest = rows.length
    ? await db
        .selectDistinctOn([transcriptSegmentSpeakers.segmentId], { segmentId: transcriptSegmentSpeakers.segmentId, speaker: transcriptSegmentSpeakers.speaker, assignedAt: transcriptSegmentSpeakers.assignedAt })
        .from(transcriptSegmentSpeakers)
        .where(
          inArray(
            transcriptSegmentSpeakers.segmentId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(transcriptSegmentSpeakers.segmentId, desc(transcriptSegmentSpeakers.assignedAt), desc(transcriptSegmentSpeakers.id))
    : []
  const assigned = new Map(latest.map((a) => [a.segmentId, a]))
  for (const r of rows) {
    const a = assigned.get(r.id)
    const reviewed = a ? (a.speaker === 'Unknown' ? null : a.speaker) : undefined
    out.get(r.transcriptId)!.push({
      id: r.label,
      speaker: a ? (reviewed ?? null) : r.speaker,
      text: r.text,
      chunkIndex: r.chunkIndex,
      startMs: r.startMs,
      endMs: r.endMs,
      language: r.language,
      confidence: r.confidence,
      speakerSource: a ? (reviewed ? 'doctor_assigned' : 'none') : (r.speakerSource as TranscriptSegment['speakerSource']),
      speakerAssignedAt: a?.assignedAt.toISOString() ?? null,
      runId: r.runId,
    })
  }
  return out
}

export async function segmentRows(db: DbOrTx, transcriptId: string) {
  return db.select().from(transcriptSegments).where(eq(transcriptSegments.transcriptId, transcriptId))
}

/** Segment ids (uuids) by citation label for one transcript, for the labels given. */
export async function segmentIdsByLabel(db: DbOrTx, transcriptId: string, labels: string[]): Promise<Map<string, string>> {
  if (!labels.length) return new Map()
  const rows = await db
    .select({ id: transcriptSegments.id, label: transcriptSegments.label })
    .from(transcriptSegments)
    .where(and(eq(transcriptSegments.transcriptId, transcriptId), inArray(transcriptSegments.label, labels)))
  return new Map(rows.map((r) => [r.label, r.id]))
}

/** Speakers treated as the patient side vs. clinicians, for attribution checks. */
export const PATIENT_SIDE = new Set(['Patient', 'Mother', 'Father', 'Relative', 'Attendant'])
export const CLINICIAN_SIDE = new Set(['Doctor', 'Nurse'])
