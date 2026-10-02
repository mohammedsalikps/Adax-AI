import { sql } from 'drizzle-orm'
import type { DbOrTx } from './client.ts'

/** Where a visit or consultation status change came from (kept in the status history). */
export type LifecycleSource = 'check_in' | 'queue' | 'vitals' | 'consultation_start' | 'consultation_resume' | 'consultation_signed' | 'consultation_discarded'

/**
 * Names the acting user, the source and the reason for the status changes
 * made in this transaction. The status-history triggers (migration 0019) read
 * these settings, and refuse a status change by the application role that
 * names no user. Call it inside a transaction: the settings end with it.
 */
export async function setLifecycleContext(tx: DbOrTx, c: { actorId: string; source: LifecycleSource; reason?: string | null }): Promise<void> {
  await tx.execute(sql`select set_config('adaxai.actor_id', ${c.actorId}, true), set_config('adaxai.source', ${c.source}, true), set_config('adaxai.reason', ${c.reason ?? ''}, true)`)
}

/** Refusals raised by the lifecycle triggers, answered as conflicts (the API checks first; these are the backstop). */
export const LIFECYCLE_REFUSALS: Record<string, { code: string; message: string }> = {
  AX003: { code: 'invalid_transition', message: 'This status change is not allowed in the current state. Refresh and try again.' },
  AX004: { code: 'consultation_in_progress', message: 'This visit has an unsigned consultation. The doctor must sign or discard it first.' },
  AX005: { code: 'visit_in_consultation', message: 'The patient is with the doctor; the doctor and department cannot change now.' },
}
