import type { AiStatus } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera } from 'lucide-react'
import { Button } from '../../components/ui/Button.tsx'
import { Alert, Badge, EmptyState, Spinner } from '../../components/ui/Feedback.tsx'
import { Card, PageHeader } from '../../components/ui/Layout.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { useToast } from '../../components/ui/Toast.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { JOB_LABEL } from '../../lib/ai.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'

interface Outcome {
  subject: string
  provider: string
  model: string
  version: string | null
  counts: Record<string, number>
  dataOrigins: Record<string, number>
  decided: number
  acceptedShare: number | null
  editedShare: number | null
}
interface Overview {
  status: AiStatus
  settingsSha256: string
  jobs: { kind: string; status: string; data_origin: string; n: number }[]
  failures: { kind: string; code: string; n: number }[]
  models: { provider: string; model: string; capability: string; firstUsedAt: string; lastUsedAt: string }[]
  prompts: { id: string; kind: string; sha256: string; registeredAt: string }[]
  outcomes: Outcome[]
  evaluations: { id: string; createdAt: string; createdByName: string | null; pipelineVersion: string; nonClinical: boolean; metrics: { statements: string[] } }[]
}

const SUBJECT: Record<string, string> = { fact: 'Extracted facts', recommendation: 'Recommendations', draft_item: 'Note suggestions', image_analysis: 'Image descriptions' }
const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`)

function ProviderRow({ label, p }: { label: string; p: AiStatus['llm'] }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="w-40 font-medium">{label}</span>
      {p.available ? <Badge tone="ok">Available · {p.provider} · {p.model}</Badge> : <Badge>Unavailable</Badge>}
      {!p.available && p.reason && <span className="text-ink-muted">{p.reason}</span>}
    </li>
  )
}

/** AI operations for administrators: configuration state and counts only, never clinical content. */
export function AdminAiOperationsPage() {
  useDocumentTitle('AI operations')
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['ai-oversight'], queryFn: () => api<Overview>('/ai-oversight/overview') })
  const snapshot = useMutation({ mutationFn: () => api('/ai-oversight/evaluations', { method: 'POST' }), onSuccess: () => (void qc.invalidateQueries({ queryKey: ['ai-oversight'] }), toast('success', 'Snapshot stored')) })
  const o = q.data
  return (
    <>
      <PageHeader title="AI operations" description="Provider configuration, job counts and doctor review outcomes. Counts only: no patient data is shown here." />
      <Alert tone="warning" title="Not a measure of accuracy" className="mb-6">
        Review outcomes show how often doctors accepted, edited or rejected AI output. They are not clinical validation, and the system does not learn from them automatically. Changing models or prompts is a configuration and governance decision.
      </Alert>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {o && (
        <div className="space-y-6">
          <Card title="Providers">
            <ul className="space-y-2">
              <ProviderRow label="Language model" p={o.status.llm} />
              <ProviderRow label="Speech-to-text" p={o.status.stt} />
              <ProviderRow label="Image description" p={o.status.vision} />
            </ul>
            <p className="mt-3 text-xs text-ink-muted">
              Features: {Object.entries(o.status.features).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(' · ')} · live chunk {o.status.liveChunkSeconds} s · settings {o.settingsSha256.slice(0, 12)}… (config/adaxai.yaml; keys in .env, never shown)
            </p>
          </Card>

          <Card title="Jobs in the last 30 days" bodyClassName="">
            <Table
              caption="AI and rules jobs by kind and outcome"
              rows={o.jobs}
              rowKey={(r) => `${r.kind}-${r.status}-${r.data_origin}`}
              empty={<div className="p-5"><EmptyState title="No jobs yet" /></div>}
              columns={[
                { key: 'k', header: 'Kind', cell: (r) => JOB_LABEL[r.kind] ?? r.kind },
                { key: 's', header: 'Outcome', cell: (r) => <Badge tone={r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'down' : 'warn'}>{r.status}</Badge> },
                { key: 'o', header: 'Data origin', cell: (r) => (r.data_origin === 'clinical' ? 'Clinical' : 'Synthetic') },
                { key: 'n', header: 'Count', cell: (r) => <span className="tabular-nums">{r.n}</span> },
              ]}
            />
            {o.failures.length > 0 && (
              <p className="p-5 text-sm">
                <span className="font-medium">Failure reasons:</span> {o.failures.map((f) => `${JOB_LABEL[f.kind] ?? f.kind} ${f.code} (${f.n})`).join(' · ')}
              </p>
            )}
          </Card>

          <Card
            title="Doctor review outcomes"
            bodyClassName=""
            actions={
              <Button size="sm" variant="secondary" icon={<Camera aria-hidden="true" className="size-4" />} loading={snapshot.isPending} onClick={() => snapshot.mutate()}>
                Store snapshot
              </Button>
            }
          >
            {snapshot.isError && <Alert tone="error" className="m-5">{errorMessage(snapshot.error)}</Alert>}
            <Table
              caption="Review outcomes by output type and model version"
              rows={o.outcomes}
              rowKey={(r) => `${r.subject}-${r.provider}-${r.model}-${r.version}`}
              empty={<div className="p-5"><EmptyState title="No AI output reviewed yet" /></div>}
              columns={[
                { key: 's', header: 'Output', cell: (r) => SUBJECT[r.subject] ?? r.subject },
                { key: 'm', header: 'Produced by', cell: (r) => <span className="text-xs">{r.provider} · {r.model}{r.version ? ` · ${r.version}` : ''}</span> },
                { key: 'd', header: 'Decided', cell: (r) => <span className="tabular-nums">{r.decided} of {Object.values(r.counts).reduce((a, b) => a + b, 0)}</span> },
                { key: 'a', header: 'Accepted (incl. edited)', cell: (r) => pct(r.acceptedShare) },
                { key: 'e', header: 'Edited', cell: (r) => pct(r.editedShare) },
                { key: 'o', header: 'Data', cell: (r) => (Object.keys(r.dataOrigins).every((k) => k === 'clinical') ? 'Clinical' : <Badge tone="notice">Includes synthetic</Badge>) },
              ]}
            />
            {o.evaluations.length > 0 && (
              <div className="space-y-1 p-5 text-sm">
                <p className="font-medium">Stored snapshots</p>
                <ul className="space-y-1">
                  {o.evaluations.map((e) => (
                    <li key={e.id}>
                      {fmtDateTime(e.createdAt)} · {e.createdByName} · {e.pipelineVersion} {e.nonClinical && <Badge tone="notice">Non-clinical data</Badge>}
                      <span className="block text-xs text-ink-muted">{e.metrics.statements.join(' ')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card title="Models used">
              {!o.models.length && <p className="text-sm text-ink-muted">None yet.</p>}
              <ul className="space-y-1 text-sm">
                {o.models.map((m) => (
                  <li key={`${m.provider}-${m.model}-${m.capability}`}>
                    {m.provider} · {m.model} <span className="text-ink-muted">({m.capability}; last used {fmtDateTime(m.lastUsedAt)})</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Prompt versions">
              {!o.prompts.length && <p className="text-sm text-ink-muted">Registered on first use.</p>}
              <ul className="space-y-1 text-sm">
                {o.prompts.map((p) => (
                  <li key={p.id}>
                    {p.id} <span className="font-mono text-xs text-ink-muted">{p.sha256.slice(0, 12)}…</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </>
  )
}
