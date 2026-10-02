import { VISIT_STATUS_LABELS, type VisitStatus } from '@adaxai/contracts'
import { FileCheck2, FilePen, CalendarX } from 'lucide-react'
import { Link } from 'react-router'
import { errorMessage } from '../../lib/api.ts'
import { usePortalBase } from '../../lib/clinical.ts'
import { useTimeline } from '../../lib/encounters.ts'
import { fmtDate } from '../../lib/format.ts'
import { Alert, Badge, Spinner } from '../ui/Feedback.tsx'
import { Card } from '../ui/Layout.tsx'

/** The patient's history, newest first: signed consultations with diagnoses and medicines, and other visits. */
export function Timeline({ patientId }: { patientId: string }) {
  const base = usePortalBase()
  const q = useTimeline(patientId)
  return (
    <Card title="Timeline">
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && !q.data.length && <p className="text-sm text-ink-muted">No visits yet.</p>}
      {q.data && q.data.length > 0 && (
        <ol className="relative space-y-5 border-l border-line pl-6">
          {q.data.map((t) => {
            const Icon = t.kind === 'encounter' ? (t.status === 'signed' ? FileCheck2 : FilePen) : CalendarX
            return (
              <li key={t.id} className="relative">
                <span className="absolute top-0.5 -left-[35px] flex size-6 items-center justify-center rounded-full border border-line bg-surface">
                  <Icon aria-hidden="true" className="size-3.5 text-ink-muted" />
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">
                    {fmtDate(t.date)} · {t.title}
                  </p>
                  {t.kind === 'encounter' ? (
                    t.status === 'signed' ? <Badge tone="ok">Signed</Badge> : <Badge tone="warn">Draft</Badge>
                  ) : (
                    <Badge>{VISIT_STATUS_LABELS[t.status as VisitStatus] ?? t.status}</Badge>
                  )}
                  {t.amendmentCount > 0 && <Badge tone="notice">{t.amendmentCount} amendment{t.amendmentCount > 1 ? 's' : ''}</Badge>}
                </div>
                <p className="text-sm text-ink-muted">{[t.departmentName, t.doctorName].filter(Boolean).join(' · ')}</p>
                {t.diagnoses.length > 0 && (
                  <p className="mt-1 text-sm">
                    <span className="text-ink-muted">Diagnosis: </span>
                    {t.diagnoses.join('; ')}
                  </p>
                )}
                {t.medications.length > 0 && (
                  <p className="text-sm">
                    <span className="text-ink-muted">Medicines: </span>
                    {t.medications.join(', ')}
                  </p>
                )}
                {t.encounterId && (
                  <Link to={`${base}/encounters/${t.encounterId}`} className="mt-1 inline-block text-sm font-medium text-brand-strong underline underline-offset-2">
                    Open consultation
                  </Link>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
