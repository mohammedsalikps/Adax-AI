import { and, asc, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from '../db/client.ts'
import { clinicalFacts } from '../db/schema.ts'
import { loadEvidence } from './review.ts'

export interface ConfirmedPoint {
  id: string
  category: string
  /** The doctor's text if they edited it, otherwise the proposed text. */
  text: string
  edited: boolean
  attribution: string
  negated: boolean
  transcriptId: string
  /** The transcript lines (S1, S2, ...) it rests on. */
  sourceSegmentIds: string[]
  confirmedAt: string
}

/**
 * The important points the doctor confirmed (accepted or edited) in a consultation, with the lines they rest on. This is what a later
 * summary may use as input: nothing the doctor rejected or has not yet reviewed is here, and nothing here is part of the record until the
 * doctor puts it into the note.
 */
export async function listConfirmedPoints(db: DbOrTx, encounterId: string): Promise<ConfirmedPoint[]> {
  const rows = await db
    .select()
    .from(clinicalFacts)
    .where(and(eq(clinicalFacts.encounterId, encounterId), inArray(clinicalFacts.status, ['accepted', 'edited'])))
    .orderBy(asc(clinicalFacts.createdAt), asc(clinicalFacts.sortOrder))
  const evidence = await loadEvidence(
    db,
    rows.map((r) => r.id),
  )
  return rows.map((r) => ({
    id: r.id,
    category: r.category,
    text: r.finalText ?? r.text,
    edited: r.status === 'edited',
    attribution: r.attribution,
    negated: r.negated,
    transcriptId: r.transcriptId,
    sourceSegmentIds: [...new Set((evidence.get(r.id) ?? []).filter((x) => x.sourceType === 'transcript_segment' && x.relation === 'supports').map((x) => x.sourceRef))],
    confirmedAt: (r.decidedAt ?? r.createdAt).toISOString(),
  }))
}
