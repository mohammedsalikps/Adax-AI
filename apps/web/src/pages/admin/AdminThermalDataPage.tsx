import { CAPTURE_FINDINGS, DATA_ORIGIN_LABELS, type DataOrigin, ROI_FINDINGS, type ThermalDatasetExport, type ThermalDataSummary } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, PackagePlus } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/Button.tsx'
import { Alert, Badge, EmptyState, Spinner } from '../../components/ui/Feedback.tsx'
import { Card, PageHeader } from '../../components/ui/Layout.tsx'
import { Table } from '../../components/ui/Table.tsx'
import { useToast } from '../../components/ui/Toast.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'

const FINDINGS: Record<string, string> = { ...CAPTURE_FINDINGS, ...ROI_FINDINGS }
const originLabel = (o: string) => DATA_ORIGIN_LABELS[o as DataOrigin] ?? o
const origins = (m: Record<string, number>) => Object.entries(m).map(([o, n]) => `${originLabel(o)}: ${n}`).join(' · ') || '—'

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
    </div>
  )
}

interface Proportion {
  value: number
  k: number
  n: number
  ci95: [number, number]
}
const pct = (p: Proportion | null | undefined) => (p ? `${(p.value * 100).toFixed(1)}% (${p.k}/${p.n}; 95% CI ${(p.ci95[0] * 100).toFixed(1)}–${(p.ci95[1] * 100).toFixed(1)}%)` : 'not estimable')

interface Report {
  pipelineVersion: string
  validated: false
  nonClinical: boolean
  statements: string[]
  dataset: { captures: number; subjects: number; dataOrigins: Record<string, number>; reference: { positive: number; negative: number; unusable: number; raterDisagreements: number }; raterAgreement: { capturesWithMultipleRaters: number; agreed: number } }
  ruleEvaluation: { rule: string; rulesVersion: string; applicable: number; notApplicable: number; confusion: { tp: number; fp: number; tn: number; fn: number }; sensitivity: Proportion | null; specificity: Proportion | null; ppv: Proportion | null; npv: Proportion | null; warnings: string[] }
  model: { status: 'trained' | 'skipped'; reason?: string; features: string[]; validation?: string; auc?: number | null; sensitivity?: Proportion | null; specificity?: Proportion | null }
}

function EvaluationReport({ e }: { e: NonNullable<ThermalDatasetExport['evaluation']> }) {
  const r = e.report as unknown as Report
  const rule = r.ruleEvaluation
  return (
    <div className="space-y-4 text-sm" data-testid="evaluation-report">
      {r.statements.map((s) => (
        <Alert key={s} tone="warning">
          {s}
        </Alert>
      ))}
      <div>
        <h3 className="font-semibold">Dataset</h3>
        <p>
          {r.dataset.captures} images from {r.dataset.subjects} subject{r.dataset.subjects === 1 ? '' : 's'} · {origins(r.dataset.dataOrigins)}
        </p>
        <p>
          Reference labels: {r.dataset.reference.positive} positive, {r.dataset.reference.negative} negative, {r.dataset.reference.unusable} unlabelled or excluded · {r.dataset.reference.raterDisagreements} rater disagreement{r.dataset.reference.raterDisagreements === 1 ? '' : 's'}
        </p>
      </div>
      <div>
        <h3 className="font-semibold">Experimental asymmetry rule ({rule.rulesVersion})</h3>
        <p>
          {rule.rule}. Applicable to {rule.applicable} labelled image{rule.applicable === 1 ? '' : 's'}
          {rule.notApplicable ? ` (${rule.notApplicable} without paired regions)` : ''}.
        </p>
        <p className="tabular-nums">
          TP {rule.confusion.tp} · FP {rule.confusion.fp} · TN {rule.confusion.tn} · FN {rule.confusion.fn}
        </p>
        <p>Sensitivity: {pct(rule.sensitivity)}</p>
        <p>Specificity: {pct(rule.specificity)}</p>
        {rule.warnings.map((w) => (
          <p key={w} className="text-pending">
            {w}
          </p>
        ))}
      </div>
      <div>
        <h3 className="font-semibold">Baseline model</h3>
        {r.model.status === 'trained' ? (
          <>
            <p>
              Logistic regression on {r.model.features.join(', ')}; {r.model.validation}.
            </p>
            <p>AUC {r.model.auc ?? '—'} · sensitivity {pct(r.model.sensitivity)} · specificity {pct(r.model.specificity)}</p>
          </>
        ) : (
          <p>
            <Badge>Not trained</Badge> {r.model.reason}
          </p>
        )}
      </div>
      <p className="text-xs text-ink-muted">
        Pipeline {r.pipelineVersion} · evaluated {fmtDateTime(e.at)}
      </p>
    </div>
  )
}

export function AdminThermalDataPage() {
  useDocumentTitle('Thermal data')
  const qc = useQueryClient()
  const toast = useToast()
  const [selected, setSelected] = useState<string | null>(null)
  const summary = useQuery({ queryKey: ['thermal-data', 'summary'], queryFn: () => api<ThermalDataSummary>('/thermal-data/summary') })
  const exports = useQuery({ queryKey: ['thermal-data', 'exports'], queryFn: () => api<{ exports: ThermalDatasetExport[] }>('/thermal-data/exports'), select: (d) => d.exports })
  const refresh = () => void qc.invalidateQueries({ queryKey: ['thermal-data'] })
  const create = useMutation({
    mutationFn: () => api<ThermalDatasetExport>('/thermal-data/exports', { method: 'POST' }),
    onSuccess: (d) => (refresh(), setSelected(d.id), toast('success', `Export created: ${d.summary.captures} image(s)`)),
  })
  const evaluate = useMutation({
    mutationFn: (id: string) => api<ThermalDatasetExport>(`/thermal-data/exports/${id}/evaluate`, { method: 'POST' }),
    onSuccess: (d) => (refresh(), setSelected(d.id), toast('success', 'Evaluation complete')),
  })
  const s = summary.data
  const nonClinical = s && Object.keys(s.dataOrigins).some((o) => o !== 'clinical')
  const current = exports.data?.find((e) => e.id === selected) ?? exports.data?.find((e) => e.evaluation)
  return (
    <>
      <PageHeader title="Thermal data" description="Counts, de-identified dataset exports and evaluation. No patient-identifiable data is shown here." />
      <Alert tone="warning" title="Research and tool development only" className="mb-6">
        Exports include only doctor-approved images of patients who consented to de-identified research use. The experimental rules and any baseline model are not clinically validated, and their results are not evidence of diagnostic accuracy.
      </Alert>

      {summary.isPending && <Spinner />}
      {summary.isError && <Alert tone="error">{errorMessage(summary.error)}</Alert>}
      {s && (
        <section aria-label="Summary" className="mb-6 space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Approved images" value={s.captures.approved} hint={`${s.captures.draft} awaiting review · ${s.captures.rejected} rejected`} />
            <Stat label="With research consent" value={s.approvedWithResearchConsent} hint="Eligible for export" />
            <Stat label="Labelled images" value={s.labelledCaptures} hint={`${s.activeLabels} active label${s.activeLabels === 1 ? '' : 's'}`} />
            <Stat label="Data origin" value={nonClinical ? 'Non-clinical' : s.captures.approved ? 'Clinical' : '—'} hint={origins(s.dataOrigins)} />
          </div>
          {Object.keys(s.labelCounts).length > 0 && (
            <p className="text-sm">
              <span className="font-medium">Active labels:</span> {Object.entries(s.labelCounts).map(([c, n]) => `${FINDINGS[c] ?? c} (${n})`).join(' · ')}
            </p>
          )}
        </section>
      )}

      <Card
        title="Dataset exports"
        bodyClassName=""
        actions={
          <Button size="sm" icon={<PackagePlus aria-hidden="true" className="size-4" />} loading={create.isPending} disabled={!s?.approvedWithResearchConsent} onClick={() => create.mutate()}>
            Create export
          </Button>
        }
      >
        {create.isError && <Alert tone="error" className="m-5">{errorMessage(create.error)}</Alert>}
        {evaluate.isError && <Alert tone="error" className="m-5">{errorMessage(evaluate.error)}</Alert>}
        {exports.isPending && <div className="px-5"><Spinner /></div>}
        {exports.data && (
          <Table
            caption="Dataset exports"
            rows={exports.data}
            rowKey={(e) => e.id}
            empty={<div className="p-5"><EmptyState title="No exports yet">Create an export once approved images with research consent exist.</EmptyState></div>}
            columns={[
              { key: 'd', header: 'Created', cell: (e) => <><p className="whitespace-nowrap">{fmtDateTime(e.createdAt)}</p><p className="text-xs text-ink-muted">{e.createdByName}</p></> },
              { key: 'c', header: 'Contents', cell: (e) => <><p>{e.summary.captures} images · {e.summary.subjects} subjects · {e.summary.labelledCaptures} labelled</p><p className="text-xs text-ink-muted">{origins(e.summary.dataOrigins)}{e.summary.excludedNoResearchConsent ? ` · ${e.summary.excludedNoResearchConsent} excluded (no research consent)` : ''}</p></> },
              { key: 'f', header: 'File', cell: (e) => <><p className="tabular-nums">{(e.sizeBytes / 1024).toFixed(0)} KB</p><p className="font-mono text-xs text-ink-muted" title={e.fileSha256}>SHA-256 {e.fileSha256.slice(0, 12)}…</p></> },
              {
                key: 'a',
                header: 'Actions',
                cell: (e) => (
                  <div className="flex flex-wrap gap-2">
                    <a href={`/api/thermal-data/exports/${e.id}/download`} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-sm font-medium text-brand-strong underline underline-offset-2 hover:bg-canvas">
                      <Download aria-hidden="true" className="size-4" /> Download
                    </a>
                    <Button size="sm" variant="secondary" loading={evaluate.isPending && evaluate.variables === e.id} onClick={() => evaluate.mutate(e.id)}>
                      {e.evaluation ? 'Re-run evaluation' : 'Evaluate'}
                    </Button>
                    {e.evaluation && (
                      <Button size="sm" variant="ghost" aria-pressed={current?.id === e.id} onClick={() => setSelected(e.id)}>
                        View report
                      </Button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      {current?.evaluation && (
        <Card title={`Evaluation report · export of ${fmtDateTime(current.createdAt)}`} className="mt-6">
          <EvaluationReport e={current.evaluation} />
        </Card>
      )}
    </>
  )
}
