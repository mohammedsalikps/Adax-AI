import fs from 'node:fs/promises'
import { and, eq, isNull, lt } from 'drizzle-orm'
import { audit } from '../audit/audit.ts'
import type { Db } from '../db/client.ts'
import { encounters, files } from '../db/schema.ts'
import type { AppSettings } from '../settings/schema.ts'
import { resolveStoragePath } from './storage.ts'

export interface RetentionResult {
  days: number
  candidates: number
  deleted: number
  dryRun: boolean
}

/**
 * Deletes the stored bytes of consultation audio from SIGNED consultations
 * older than `retention.consultationAudioDays`. The file row (who, what,
 * when, checksum), the transcript and the signed note are kept; each deletion
 * is audited. Nothing else is deleted by this policy.
 */
export async function runRetention(db: Db, storageDir: string, settings: AppSettings, opts: { dryRun: boolean; now?: Date }): Promise<RetentionResult> {
  const days = settings.retention.consultationAudioDays
  if (days === 0) return { days, candidates: 0, deleted: 0, dryRun: opts.dryRun }
  const cutoff = new Date((opts.now ?? new Date()).getTime() - days * 86_400_000)
  const rows = await db
    .select({ f: files })
    .from(files)
    .innerJoin(encounters, eq(encounters.id, files.encounterId))
    .where(and(eq(files.kind, 'consultation_audio'), isNull(files.deletedAt), lt(files.createdAt, cutoff), eq(encounters.status, 'signed')))
  if (opts.dryRun) return { days, candidates: rows.length, deleted: 0, dryRun: true }
  let deleted = 0
  for (const { f } of rows) {
    await fs.rm(resolveStoragePath(storageDir, f.storageKey), { force: true })
    await db.transaction(async (tx) => {
      await tx.update(files).set({ deletedAt: new Date(), deletedReason: `retention: consultation audio older than ${days} days after signing` }).where(and(eq(files.id, f.id), isNull(files.deletedAt)))
      await audit(tx, null, { action: 'file.retention_delete', actorUserId: null, actorRole: null, entityType: 'file', entityId: f.id, patientId: f.patientId, details: { kind: f.kind, days, sha256: f.sha256 } })
    })
    deleted++
  }
  return { days, candidates: rows.length, deleted, dryRun: false }
}
