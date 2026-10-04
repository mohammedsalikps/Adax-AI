import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Alert, EmptyState, Spinner } from '../../components/ui/Feedback.tsx'
import { Card, PageHeader } from '../../components/ui/Layout.tsx'
import { api, errorMessage } from '../../lib/api.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'

interface Item {
  id: string
  subjectType: string
  category: string
  originalText: string | null
  finalText: string | null
  reason: string | null
  reviewer: string
  reviewedAt: string
  patient: { id: string; name: string; mrn: string }
  encounterId: string | null
  producedBy: { provider: string | null; model: string | null; version: string | null }
}

const SUBJECT: Record<string, string> = { fact: 'Fact', recommendation: 'Recommendation', draft_item: 'Note suggestion', image_analysis: 'Image description', consultation_item: 'Consultation draft statement' }

/** Rejected and edited AI output, for doctors reviewing where the assistant goes wrong. */
export function AiReviewPage() {
  useDocumentTitle('AI review')
  const [decision, setDecision] = useState<'rejected' | 'edited'>('rejected')
  const q = useQuery({ queryKey: ['ai', 'review-outcomes', decision], queryFn: () => api<{ items: Item[] }>('/ai/review-outcomes', { query: { decision } }), select: (d) => d.items })
  return (
    <>
      <PageHeader title="AI review" description="AI output that doctors rejected or corrected, with the model and prompt that produced it. Use it to spot recurring problems; it does not retrain anything." />
      <div role="group" aria-label="Filter" className="mb-4 inline-flex rounded-md border border-line bg-surface p-0.5">
        {(['rejected', 'edited'] as const).map((d) => (
          <button key={d} type="button" aria-pressed={decision === d} onClick={() => setDecision(d)} className={`rounded px-3 py-1.5 text-sm font-medium ${decision === d ? 'bg-brand-soft text-brand-strong' : 'text-ink-muted hover:text-ink'}`}>
            {d === 'rejected' ? 'Rejected' : 'Edited'}
          </button>
        ))}
      </div>
      {q.isPending && <Spinner />}
      {q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {q.data && !q.data.length && <EmptyState title="Nothing here">No {decision} AI output yet.</EmptyState>}
      <ul className="space-y-3">
        {q.data?.map((i) => (
          <li key={i.id}>
            <Card>
              <div className="space-y-1 text-sm">
                <p className="font-medium">
                  {SUBJECT[i.subjectType] ?? i.subjectType} · {i.category.replace(/_/g, ' ')}
                </p>
                <p>
                  <span className="text-ink-muted">AI said:</span> {i.originalText ?? '—'}
                </p>
                {i.finalText && decision === 'edited' && (
                  <p>
                    <span className="text-ink-muted">Doctor’s version:</span> {i.finalText}
                  </p>
                )}
                {i.reason && (
                  <p>
                    <span className="text-ink-muted">Reason:</span> {i.reason}
                  </p>
                )}
                <p className="text-xs text-ink-muted">
                  {i.reviewer} · {fmtDateTime(i.reviewedAt)} · {i.producedBy.provider} · {i.producedBy.model}
                  {i.producedBy.version ? ` · ${i.producedBy.version}` : ''} ·{' '}
                  <Link to={i.encounterId ? `/doctor/encounters/${i.encounterId}` : `/doctor/patients/${i.patient.id}`} className="text-brand-strong underline underline-offset-2">
                    {i.patient.name} ({i.patient.mrn})
                  </Link>
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </>
  )
}
