import type { EncounterAi } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw } from 'lucide-react'
import { api, errorMessage } from '../../lib/api.ts'
import { aiKey, JOB_LABEL } from '../../lib/ai.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { Button } from '../ui/Button.tsx'
import { Alert, Badge } from '../ui/Feedback.tsx'

const ACTION_LABEL: Record<string, string> = { accepted: 'accepted', edited: 'edited and accepted', rejected: 'rejected', deferred: 'deferred' }
const SUBJECT_LABEL: Record<string, string> = { fact: 'fact', recommendation: 'recommendation', draft_item: 'note suggestion', image_analysis: 'image description', consultation_item: 'consultation draft statement' }

/** What ran, with which model and prompt or rules version, who reviewed what, and the audit trail. */
export function ActivityView({ ai, encounterId }: { ai: EncounterAi; encounterId: string }) {
  const qc = useQueryClient()
  const retry = useMutation({
    mutationFn: (jobId: string) => api<{ encounter?: EncounterAi }>(`/ai-jobs/${jobId}/retry`, { method: 'POST' }),
    onSuccess: (d) => d.encounter && qc.setQueryData(aiKey(encounterId), d.encounter),
    onSettled: () => void qc.invalidateQueries({ queryKey: aiKey(encounterId) }),
  })
  return (
    <section aria-label="AI activity" className="space-y-4 text-sm">
      <div>
        <h3 className="font-semibold">Jobs</h3>
        {!ai.jobs.length && <p className="text-ink-muted">No AI or rules jobs yet.</p>}
        {retry.isError && <Alert tone="error" className="my-2">{errorMessage(retry.error)}</Alert>}
        <ul className="mt-1 space-y-2">
          {ai.jobs.map((j) => {
            const run = j.runs[0]
            return (
              <li key={j.id} className="rounded-md border border-line p-2" data-testid="ai-job">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{JOB_LABEL[j.kind] ?? j.kind}</span>
                  <Badge tone={j.status === 'succeeded' ? 'ok' : j.status === 'failed' ? 'down' : 'warn'}>{j.status}</Badge>
                  {j.dataOrigin !== 'clinical' && <Badge tone="notice">Synthetic data</Badge>}
                  <span className="text-xs text-ink-muted">
                    {fmtDateTime(j.createdAt)} · {j.attempts} attempt{j.attempts === 1 ? '' : 's'}
                  </span>
                </div>
                {run && (
                  <p className="text-xs text-ink-muted">
                    {run.provider} · {run.model}
                    {run.promptVersion ? ` · ${run.provider === 'adaxai-rules' ? 'rules' : 'prompt'} ${run.promptVersion}` : ''}
                    {run.latencyMs !== null ? ` · ${(run.latencyMs / 1000).toFixed(1)} s` : ''}
                  </p>
                )}
                {j.status === 'failed' && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-down">{j.lastErrorMessage}</span>
                    <Button size="sm" variant="secondary" icon={<RotateCcw aria-hidden="true" className="size-4" />} loading={retry.isPending && retry.variables === j.id} onClick={() => retry.mutate(j.id)}>
                      Retry
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {ai.jobs[0]?.settingsSha256 && <p className="mt-1 text-xs text-ink-muted">Settings snapshot {ai.jobs[0].settingsSha256.slice(0, 12)}…</p>}
      </div>
      <div>
        <h3 className="font-semibold">Review decisions</h3>
        {!ai.reviewActions.length && <p className="text-ink-muted">None yet.</p>}
        <ul className="mt-1 space-y-1">
          {ai.reviewActions.map((r) => (
            <li key={r.id}>
              {fmtDateTime(r.createdAt)} · {r.actorName} {ACTION_LABEL[r.action] ?? r.action} a {SUBJECT_LABEL[r.subjectType] ?? r.subjectType}
              {r.reason ? ` (“${r.reason}”)` : ''}
            </li>
          ))}
        </ul>
      </div>
      <details>
        <summary className="cursor-pointer font-semibold">Audit trail ({ai.audit.length})</summary>
        <ul className="mt-1 space-y-0.5 text-xs">
          {ai.audit.map((a) => (
            <li key={a.id}>
              {fmtDateTime(a.occurredAt)} · {a.action} · {a.outcome} · {a.actorName ?? 'system'}
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}
