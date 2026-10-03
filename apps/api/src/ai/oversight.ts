import { and, desc, eq, sql } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { audit } from '../audit/audit.ts'
import { currentUser } from '../auth/plugin.ts'
import type { Db } from '../db/client.ts'
import { aiModels, aiPromptVersions, evaluationRuns, users } from '../db/schema.ts'
import { parse } from '../http/validate.ts'
import type { JobService } from './jobs.ts'
import { type AiProviders, aiStatus } from './providers.ts'

export const REVIEW_METRICS_VERSION = 'ai-review-metrics-v1'

interface OutcomeRow {
  subject: string
  provider: string
  model: string
  version: string | null
  status: string
  data_origin: string | null
  n: number
}

/** Review outcomes per output type and producing model/prompt version. Counts only. */
async function reviewOutcomes(db: Db, facilityId: string) {
  const { rows } = await db.execute<OutcomeRow & Record<string, unknown>>(sql`
    select 'fact' as subject, r.provider, r.model, r.prompt_version as version, f.status, j.data_origin, count(*)::int as n
      from clinical_facts f join ai_runs r on r.id = f.run_id join ai_jobs j on j.id = f.job_id
      where j.facility_id = ${facilityId} group by 1, 2, 3, 4, 5, 6
    union all
    select 'recommendation', r.provider, r.model, r.prompt_version, x.status, j.data_origin, count(*)::int
      from ai_recommendations x join ai_runs r on r.id = x.run_id join ai_jobs j on j.id = x.job_id
      where j.facility_id = ${facilityId} group by 1, 2, 3, 4, 5, 6
    union all
    select 'draft_item', r.provider, r.model, r.prompt_version, i.decision, j.data_origin, count(*)::int
      from ai_draft_items i join ai_drafts d on d.id = i.draft_id join ai_runs r on r.id = d.run_id
      join encounters e on e.id = d.encounter_id left join ai_jobs j on j.id = r.job_id
      where e.facility_id = ${facilityId} group by 1, 2, 3, 4, 5, 6
    union all
    select 'image_analysis', r.provider, r.model, r.prompt_version, a.status, j.data_origin, count(*)::int
      from image_analyses a join ai_runs r on r.id = a.run_id join ai_jobs j on j.id = a.job_id
      where j.facility_id = ${facilityId} group by 1, 2, 3, 4, 5, 6`)
  const groups = new Map<string, { subject: string; provider: string; model: string; version: string | null; counts: Record<string, number>; dataOrigins: Record<string, number> }>()
  for (const r of rows) {
    const key = `${r.subject}|${r.provider}|${r.model}|${r.version}`
    const g = groups.get(key) ?? { subject: r.subject, provider: r.provider, model: r.model, version: r.version, counts: {}, dataOrigins: {} }
    g.counts[r.status] = (g.counts[r.status] ?? 0) + r.n
    const origin = r.data_origin ?? 'unknown'
    g.dataOrigins[origin] = (g.dataOrigins[origin] ?? 0) + r.n
    groups.set(key, g)
  }
  return [...groups.values()].map((g) => {
    const accepted = (g.counts.accepted ?? 0) + (g.counts.edited ?? 0)
    const decided = accepted + (g.counts.rejected ?? 0)
    return { ...g, decided, acceptedShare: decided ? Math.round((accepted / decided) * 1000) / 1000 : null, editedShare: decided ? Math.round(((g.counts.edited ?? 0) / decided) * 1000) / 1000 : null }
  })
}

/**
 * Oversight for administrators and doctors: aggregate counts only, never
 * patient-level content. Clinical detail of rejected outputs is on the
 * doctors' review list (ai:use).
 */
export function registerOversightRoutes(app: FastifyInstance, deps: { db: Db; providers: AiProviders; jobs: JobService }) {
  const { db, providers, jobs } = deps

  app.get('/api/ai-oversight/overview', { config: { permission: 'ai:oversight' } }, async (req) => {
    const me = currentUser(req)
    const since = sql`now() - interval '30 days'`
    const { rows: jobCounts } = await db.execute<{ kind: string; status: string; data_origin: string; n: number } & Record<string, unknown>>(
      sql`select kind, status, data_origin, count(*)::int as n from ai_jobs where facility_id = ${me.facilityId} and created_at >= ${since} group by 1, 2, 3 order by 1, 2`,
    )
    const { rows: failures } = await db.execute<{ kind: string; code: string; n: number } & Record<string, unknown>>(
      sql`select kind, last_error_code as code, count(*)::int as n from ai_jobs where facility_id = ${me.facilityId} and status = 'failed' and created_at >= ${since} group by 1, 2 order by 3 desc`,
    )
    const models = await db.select().from(aiModels).orderBy(desc(aiModels.lastUsedAt))
    const prompts = await db.select().from(aiPromptVersions).orderBy(aiPromptVersions.id)
    const evaluations = await db
      .select({ e: evaluationRuns, by: users.fullName })
      .from(evaluationRuns)
      .leftJoin(users, eq(users.id, evaluationRuns.createdBy))
      .where(and(eq(evaluationRuns.facilityId, me.facilityId), eq(evaluationRuns.kind, 'ai_review')))
      .orderBy(desc(evaluationRuns.createdAt))
      .limit(10)
    return {
      status: await aiStatus(providers),
      settingsSha256: jobs.settingsSha256,
      jobs: jobCounts,
      failures,
      models: models.map((m) => ({ provider: m.provider, model: m.model, capability: m.capability, firstUsedAt: m.firstUsedAt.toISOString(), lastUsedAt: m.lastUsedAt.toISOString() })),
      prompts: prompts.map((p) => ({ id: p.id, kind: p.kind, sha256: p.sha256, registeredAt: p.createdAt.toISOString() })),
      outcomes: await reviewOutcomes(db, me.facilityId),
      evaluations: evaluations.map(({ e, by }) => ({ id: e.id, createdAt: e.createdAt.toISOString(), createdByName: by, pipelineVersion: e.pipelineVersion, nonClinical: e.nonClinical, metrics: e.metrics })),
    }
  })

  /** Stores a snapshot of review outcomes as an evaluation run (append-only). */
  app.post('/api/ai-oversight/evaluations', { config: { permission: 'ai:oversight' } }, async (req, reply) => {
    const me = currentUser(req)
    const outcomes = await reviewOutcomes(db, me.facilityId)
    const nonClinical = !outcomes.length || outcomes.some((o) => Object.keys(o.dataOrigins).some((k) => k !== 'clinical'))
    const metrics = {
      version: REVIEW_METRICS_VERSION,
      validated: false,
      statements: [
        ...(nonClinical ? ['Includes synthetic or demonstration data: these figures show that review tracking works, nothing about clinical performance.'] : []),
        'These are doctor review outcomes (how often AI output was accepted, edited or rejected), not measurements of accuracy or clinical validity.',
      ],
      outcomes,
    }
    const [row] = await db.insert(evaluationRuns).values({ facilityId: me.facilityId, kind: 'ai_review', pipelineVersion: REVIEW_METRICS_VERSION, nonClinical, metrics, createdBy: me.id }).returning({ id: evaluationRuns.id })
    await audit(db, req, { action: 'ai.evaluation_create', entityType: 'evaluation_run', entityId: row!.id, details: { kind: 'ai_review', nonClinical, groups: outcomes.length } })
    return reply.code(201).send({ id: row!.id, metrics })
  })

  /** Rejected or edited AI outputs with their clinical content, for doctors reviewing AI quality. */
  app.get('/api/ai/review-outcomes', { config: { permission: 'ai:use' } }, async (req) => {
    const me = currentUser(req)
    const q = parse(z.object({ decision: z.enum(['rejected', 'edited']).default('rejected') }), req.query)
    const { rows } = await db.execute<Record<string, unknown>>(sql`
      select a.id, a.subject_type, a.subject_id, a.action, a.text as final_text, a.reason, a.created_at, u.full_name as reviewer,
             p.id as patient_id, p.given_name, p.family_name, p.mrn, a.encounter_id,
             coalesce(f.text, r.text, i.text, ia.result->>'summary') as original_text,
             coalesce(f.category, r.kind, i.section, 'image') as category,
             run.provider, run.model, run.prompt_version
        from ai_review_actions a
        join patients p on p.id = a.patient_id
        join users u on u.id = a.actor_id
        left join clinical_facts f on a.subject_type = 'fact' and f.id = a.subject_id
        left join ai_recommendations r on a.subject_type = 'recommendation' and r.id = a.subject_id
        left join ai_draft_items i on a.subject_type = 'draft_item' and i.id = a.subject_id
        left join ai_drafts d on d.id = i.draft_id
        left join image_analyses ia on a.subject_type = 'image_analysis' and ia.id = a.subject_id
        left join ai_runs run on run.id = coalesce(f.run_id, r.run_id, d.run_id, ia.run_id)
       where p.facility_id = ${me.facilityId} and a.action = ${q.decision} and a.subject_type <> 'routing_suggestion'
       order by a.created_at desc limit 100`)
    await audit(db, req, { action: 'ai.review_outcomes_read', details: { decision: q.decision, count: rows.length, patientIds: [...new Set(rows.map((r) => String(r.patient_id)))] } })
    return {
      items: rows.map((r) => ({
        id: r.id,
        subjectType: r.subject_type,
        category: r.category,
        action: r.action,
        originalText: r.original_text,
        finalText: r.final_text,
        reason: r.reason,
        reviewer: r.reviewer,
        reviewedAt: new Date(r.created_at as string).toISOString(),
        patient: { id: r.patient_id, name: [r.given_name, r.family_name].filter(Boolean).join(' '), mrn: r.mrn },
        encounterId: r.encounter_id,
        producedBy: { provider: r.provider, model: r.model, version: r.prompt_version },
      })),
    }
  })
}
