import type { TranscriptSegment } from '@adaxai/contracts'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { transcriptSegments, transcripts } from '../db/schema.ts'

export interface NewSegment {
  speaker: string | null
  speakerSource: 'typed_label' | 'provider' | 'none'
  text: string
  chunkIndex?: number | null
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
    return { transcriptId, seq, label: `S${seq}`, speaker: s.speaker, speakerSource: s.speaker ? s.speakerSource : 'none', text: s.text, chunkIndex: s.chunkIndex ?? null }
  })
  await tx.insert(transcriptSegments).values(values)
  return values.map((v) => ({ id: v.label, speaker: v.speaker, text: v.text, chunkIndex: v.chunkIndex }))
}

/** Segments per transcript, in reading order (chunk, then sequence). */
export async function loadSegments(db: DbOrTx, transcriptIds: string[]): Promise<Map<string, TranscriptSegment[]>> {
  const out = new Map<string, TranscriptSegment[]>(transcriptIds.map((id) => [id, []]))
  if (!transcriptIds.length) return out
  const rows = await db
    .select()
    .from(transcriptSegments)
    .where(inArray(transcriptSegments.transcriptId, transcriptIds))
    .orderBy(asc(transcriptSegments.transcriptId), sql`${transcriptSegments.chunkIndex} asc nulls first`, asc(transcriptSegments.seq))
  for (const r of rows) out.get(r.transcriptId)!.push({ id: r.label, speaker: r.speaker, text: r.text, chunkIndex: r.chunkIndex })
  return out
}

export async function segmentRows(db: DbOrTx, transcriptId: string) {
  return db.select().from(transcriptSegments).where(eq(transcriptSegments.transcriptId, transcriptId))
}

/** Speakers treated as the patient side vs. clinicians, for attribution checks. */
export const PATIENT_SIDE = new Set(['Patient', 'Mother', 'Father', 'Relative', 'Attendant'])
export const CLINICIAN_SIDE = new Set(['Doctor', 'Nurse'])
