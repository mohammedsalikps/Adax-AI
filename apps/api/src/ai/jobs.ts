import crypto from 'node:crypto'
import type { AiJob, AiJobKind, AiRun } from '@adaxai/contracts'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { audit } from '../audit/audit.ts'
import type { SessionUser } from '../auth/sessions.ts'
import type { Db, DbOrTx } from '../db/client.ts'
import { aiJobs, aiModels, aiPromptVersions, aiRuns, aiSettingsSnapshots, users } from '../db/schema.ts'
import { conflict, HttpError } from '../http/errors.ts'
import { settingsHash } from '../settings/load.ts'
import { ALL_PROMPTS, promptSha256 } from './prompts.ts'
import { AiProviderError } from './providers.ts'

export const sha256 = (s: string | Buffer) => crypto.createHash('sha256').update(s).digest('hex')

type JobRow = typeof aiJobs.$inferSelect
type RunRow = typeof aiRuns.$inferSelect

export const toRun = (r: RunRow): AiRun => ({
  id: r.id,
  jobId: r.jobId,
  kind: r.kind,
  status: r.status as AiRun['status'],
  provider: r.provider,
  model: r.model,
  promptVersion: r.promptVersion,
  errorCode: r.errorCode,
  errorMessage: r.errorMessage,
  latencyMs: r.latencyMs,
  createdAt: r.createdAt.toISOString(),
})

/** What one attempt produced, before it is written. */
export interface RunRecord {
  kind: string
  provider: string
  model: string
  capability: 'llm' | 'stt' | 'vision' | 'rules'
  promptVersion: string | null
  inputSha256: string | null
  outputSha256?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  providerRequestId?: string | null
}

export interface JobServiceDeps {
  db: Db
  dataOrigin: 'clinical' | 'synthetic'
  /** Non-secret AI settings in effect; stored once, referenced by hash from every job. */
  aiSettings: unknown
}

/**
 * Jobs and their attempts. A job is created once per request (an idempotency
 * key makes resubmission return the same job); each attempt writes an ai_run;
 * outputs are persisted in the same transaction as the successful run, so a
 * failed or retried attempt never leaves partial results behind.
 */
export class JobService {
  readonly settingsSha256: string
  private promptsChecked = false

  constructor(private readonly deps: JobServiceDeps) {
    this.settingsSha256 = settingsHash(deps.aiSettings)
  }

  /** Registers prompt checksums; refuses a prompt whose text changed under an existing id. */
  async ensurePrompts(db: DbOrTx) {
    if (this.promptsChecked) return
    for (const p of ALL_PROMPTS) {
      const hash = promptSha256(p)
      await db.insert(aiPromptVersions).values({ id: p.id, kind: p.kind, sha256: hash }).onConflictDoNothing()
      const [row] = await db.select().from(aiPromptVersions).where(eq(aiPromptVersions.id, p.id))
      if (row && row.sha256 !== hash) throw new HttpError(500, 'prompt_version_conflict', `Prompt ${p.id} changed without a new version id. Give it a new id.`)
    }
    this.promptsChecked = true
  }

  /** Idempotent; done per job (one cheap statement) so it can never be missing. */
  private async ensureSnapshot(db: DbOrTx) {
    await db.insert(aiSettingsSnapshots).values({ sha256: this.settingsSha256, settings: this.deps.aiSettings as object }).onConflictDoNothing()
  }

  /**
   * Creates a job, or returns the existing one for the same idempotency key.
   * `existing` tells the caller not to run it again.
   */
  async create(
    req: FastifyRequest,
    me: SessionUser,
    o: { kind: AiJobKind; patientId: string; encounterId: string | null; input: Record<string, unknown>; idempotencyKey?: string | undefined },
  ): Promise<{ job: JobRow; existing: boolean }> {
    const { db } = this.deps
    await this.ensurePrompts(db)
    await this.ensureSnapshot(db)
    if (o.idempotencyKey) {
      const found = await db.query.aiJobs.findFirst({ where: and(eq(aiJobs.createdBy, me.id), eq(aiJobs.idempotencyKey, o.idempotencyKey)) })
      if (found) {
        if (found.kind !== o.kind || found.patientId !== o.patientId) throw conflict('That request key was already used for a different request', 'idempotency_key_reused')
        return { job: found, existing: true }
      }
    }
    const [job] = await db
      .insert(aiJobs)
      .values({
        facilityId: me.facilityId,
        patientId: o.patientId,
        encounterId: o.encounterId,
        kind: o.kind,
        status: 'running',
        input: o.input,
        idempotencyKey: o.idempotencyKey ?? null,
        dataOrigin: this.deps.dataOrigin,
        settingsSha256: this.settingsSha256,
        createdBy: me.id,
      })
      .onConflictDoNothing()
      .returning()
    if (!job) {
      // Lost a race with an identical request.
      const found = (await db.query.aiJobs.findFirst({ where: and(eq(aiJobs.createdBy, me.id), eq(aiJobs.idempotencyKey, o.idempotencyKey!)) }))!
      return { job: found, existing: true }
    }
    await audit(db, req, { action: 'ai.job_create', entityType: 'ai_job', entityId: job.id, patientId: o.patientId, details: { kind: o.kind, encounterId: o.encounterId } })
    return { job, existing: false }
  }

  /**
   * Runs one attempt. `work` calls the provider and returns the run record and
   * a `persist` step; persist + run + job status are written in one
   * transaction. Provider errors mark the job failed (retryable or not) and are
   * re-thrown as a safe HTTP error.
   */
  async attempt<T>(
    req: FastifyRequest,
    job: JobRow,
    work: () => Promise<{ run: RunRecord; summary: Record<string, unknown>; persist: (tx: DbOrTx, runId: string) => Promise<T> }>,
    failureRun: () => RunRecord,
  ): Promise<T> {
    const { db } = this.deps
    await db.update(aiJobs).set({ status: 'running', attempts: sql`${aiJobs.attempts} + 1`, updatedAt: new Date() }).where(eq(aiJobs.id, job.id))
    const started = Date.now()
    let out: Awaited<ReturnType<typeof work>>
    try {
      out = await work()
    } catch (err) {
      const pe = err instanceof AiProviderError ? err : err instanceof HttpError ? new AiProviderError(err.code, err.message, err.statusCode >= 500) : new AiProviderError('internal_error', 'Processing failed unexpectedly.', true)
      const fr = failureRun()
      await db.transaction(async (tx) => {
        const [run] = await tx
          .insert(aiRuns)
          .values({ jobId: job.id, patientId: job.patientId, encounterId: job.encounterId, kind: fr.kind, provider: fr.provider, model: fr.model, promptVersion: fr.promptVersion, status: 'failed', errorCode: pe.code, errorMessage: pe.message, inputSha256: fr.inputSha256, latencyMs: Date.now() - started, createdBy: req.user?.id ?? null })
          .returning({ id: aiRuns.id })
        await tx.update(aiJobs).set({ status: 'failed', lastErrorCode: pe.code, lastErrorMessage: pe.message, retryable: pe.retryable, updatedAt: new Date(), completedAt: new Date() }).where(eq(aiJobs.id, job.id))
        await audit(tx, req, { action: `ai.${job.kind}`, outcome: 'failure', entityType: 'ai_job', entityId: job.id, patientId: job.patientId, details: { runId: run!.id, code: pe.code, provider: fr.provider, model: fr.model } })
      })
      if (!(err instanceof AiProviderError) && !(err instanceof HttpError)) req.log.error({ err, jobId: job.id }, 'AI job failed unexpectedly')
      throw new HttpError(502, `ai_${pe.code}`, `${pe.message}${pe.retryable ? ' You can retry.' : ''}`)
    }
    return db.transaction(async (tx) => {
      const r = out.run
      const [run] = await tx
        .insert(aiRuns)
        .values({
          jobId: job.id,
          patientId: job.patientId,
          encounterId: job.encounterId,
          kind: r.kind,
          provider: r.provider,
          model: r.model,
          promptVersion: r.promptVersion,
          status: 'succeeded',
          inputSha256: r.inputSha256,
          outputSha256: r.outputSha256 ?? null,
          inputTokens: r.inputTokens ?? null,
          outputTokens: r.outputTokens ?? null,
          latencyMs: Date.now() - started,
          providerRequestId: r.providerRequestId ?? null,
          createdBy: req.user?.id ?? null,
        })
        .returning({ id: aiRuns.id })
      await tx
        .insert(aiModels)
        .values({ provider: r.provider, model: r.model, capability: r.capability })
        .onConflictDoUpdate({ target: [aiModels.provider, aiModels.model, aiModels.capability], set: { lastUsedAt: new Date() } })
      const result = await out.persist(tx, run!.id)
      await tx.update(aiJobs).set({ status: 'succeeded', lastErrorCode: null, lastErrorMessage: null, retryable: false, summary: out.summary, updatedAt: new Date(), completedAt: new Date() }).where(eq(aiJobs.id, job.id))
      await audit(tx, req, { action: `ai.${job.kind}`, entityType: 'ai_job', entityId: job.id, patientId: job.patientId, details: { runId: run!.id, provider: r.provider, model: r.model, promptVersion: r.promptVersion, ...out.summary } })
      return result
    })
  }
}

export async function loadJobs(db: Db, where: { encounterId?: string; ids?: string[] }): Promise<AiJob[]> {
  const cond = where.encounterId ? eq(aiJobs.encounterId, where.encounterId) : where.ids?.length ? inArray(aiJobs.id, where.ids) : sql`false`
  const rows = await db.select({ j: aiJobs, by: users.fullName }).from(aiJobs).leftJoin(users, eq(users.id, aiJobs.createdBy)).where(cond).orderBy(desc(aiJobs.createdAt)).limit(50)
  const runs = rows.length
    ? await db
        .select()
        .from(aiRuns)
        .where(
          inArray(
            aiRuns.jobId,
            rows.map((r) => r.j.id),
          ),
        )
        .orderBy(desc(aiRuns.createdAt))
    : []
  return rows.map(({ j, by }) => ({
    id: j.id,
    kind: j.kind as AiJob['kind'],
    status: j.status as AiJob['status'],
    attempts: j.attempts,
    lastErrorCode: j.lastErrorCode,
    lastErrorMessage: j.lastErrorMessage,
    retryable: j.retryable,
    dataOrigin: j.dataOrigin,
    settingsSha256: j.settingsSha256,
    summary: (j.summary as Record<string, unknown> | null) ?? null,
    createdAt: j.createdAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
    createdByName: by,
    runs: runs.filter((r) => r.jobId === j.id).map(toRun),
  }))
}
