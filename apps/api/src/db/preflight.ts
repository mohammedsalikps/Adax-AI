import type pg from 'pg'

/**
 * Data conditions a migration needs before it can be applied, checked by the migration runner BEFORE the migration runs, so that a database that
 * does not meet one is told so in words (and what to do) instead of failing inside the migration with a raw SQL error. Migrations themselves are
 * never edited once applied; a condition that an older version of the application could have broken lives here.
 *
 * A check only reads. The remedy for a failed check changes data, so the runner runs it only when the operator asks for it by name
 * (`npm run db:migrate -- --target <db> --end-duplicate-live-recordings`), and it says how many rows it changed.
 */
export interface Preflight {
  /** The migration file this guards. */
  migration: string
  /** The flag that lets the runner apply the remedy. */
  flag: string
  /** A message if the database does not meet the condition, or null if it does. */
  check(client: pg.Client): Promise<string | null>
  /** Fixes the data; returns how many rows it changed. */
  remedy(client: pg.Client): Promise<number>
}

/**
 * Migration 0025 allows ONE live recording per consultation (a unique index). Before slice V2 the application could leave several recordings of one
 * consultation "live" (a tab closed without stopping), and building the index would then fail. Such a recording is a recording nobody is making
 * any more: the remedy ends all but the newest one per consultation, as a doctor's stop would have (their transcript lines are kept).
 */
export async function duplicateLiveRecordings(client: pg.Client): Promise<{ consultations: number; recordings: number }> {
  const { rows } = await client.query<{ consultations: string; recordings: string }>(
    `SELECT count(*) AS consultations, coalesce(sum(n - 1), 0) AS recordings
       FROM (SELECT encounter_id, count(*) AS n FROM transcripts WHERE status = 'live' GROUP BY encounter_id HAVING count(*) > 1) d`,
  )
  return { consultations: Number(rows[0]!.consultations), recordings: Number(rows[0]!.recordings) }
}

export const endDuplicateLiveRecordings = async (client: pg.Client): Promise<number> =>
  (
    await client.query(
      `UPDATE transcripts SET status = 'final', ended_at = coalesce(ended_at, now())
        WHERE status = 'live'
          AND id NOT IN (SELECT DISTINCT ON (encounter_id) id FROM transcripts WHERE status = 'live' ORDER BY encounter_id, created_at DESC, id DESC)`,
    )
  ).rowCount ?? 0

export const PREFLIGHTS: Preflight[] = [
  {
    migration: '0025_capture_v2.sql',
    flag: '--end-duplicate-live-recordings',
    async check(client) {
      const d = await duplicateLiveRecordings(client)
      if (d.recordings === 0) return null
      return `${d.consultations} consultation(s) have more than one recording still marked "live" (${d.recordings} extra), left by an earlier version of the application. Migration 0025 allows one per consultation. Nothing was changed. To end the extra ones (all but the newest per consultation; their transcript lines are kept) run: npm run db:migrate -- --target <dev|test|e2e> --end-duplicate-live-recordings`
    },
    remedy: endDuplicateLiveRecordings,
  },
]
