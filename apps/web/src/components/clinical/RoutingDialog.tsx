import type { RoutingResponse, Visit } from '@adaxai/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, Badge, Spinner } from '../ui/Feedback.tsx'
import { TextAreaField } from '../ui/Form.tsx'
import { DescriptionList } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'

/**
 * Rule-based routing suggestion for one visit. Staff apply it or override it
 * with a reason; red flags show the configured instruction and always need a
 * person to act.
 */
export function RoutingDialog({ visit, onClose }: { visit: Visit; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const key = ['visit', visit.id, 'routing']
  const q = useQuery({ queryKey: key, queryFn: () => api<RoutingResponse>(`/visits/${visit.id}/routing-suggestion`) })
  const [overriding, setOverriding] = useState(false)
  const [reason, setReason] = useState('')
  const done = (d: RoutingResponse) => {
    qc.setQueryData(key, d)
    void qc.invalidateQueries({ queryKey: ['visits'] })
  }
  const suggest = useMutation({ mutationFn: () => api<RoutingResponse>(`/visits/${visit.id}/routing-suggestion`, { method: 'POST' }), onSuccess: done })
  const apply = useMutation({ mutationFn: (id: string) => api<RoutingResponse>(`/routing-suggestions/${id}/apply`, { method: 'POST' }), onSuccess: (d) => (done(d), toast('success', 'Routing applied to the visit')) })
  const override = useMutation({ mutationFn: (id: string) => api<RoutingResponse>(`/routing-suggestions/${id}/override`, { method: 'POST', body: { reason } }), onSuccess: (d) => (done(d), setOverriding(false), toast('success', 'Override recorded')) })
  const s = q.data?.suggestion
  const pending = s?.status === 'pending'
  const error = suggest.error ?? apply.error ?? override.error

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Routing · token ${visit.tokenNumber} · ${visit.patient.fullName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" loading={suggest.isPending} onClick={() => suggest.mutate()}>
            {s ? 'Suggest again' : 'Suggest routing'}
          </Button>
          {pending && !overriding && (
            <>
              <Button variant="secondary" onClick={() => setOverriding(true)}>
                Override
              </Button>
              <Button loading={apply.isPending} disabled={!s.suggestion.departmentId} onClick={() => apply.mutate(s.id)}>
                Apply suggestion
              </Button>
            </>
          )}
          {pending && overriding && (
            <Button loading={override.isPending} disabled={!reason.trim()} onClick={() => override.mutate(s.id)}>
              Record override
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-ink-muted">Suggestions come from explicit routing rules, not AI. They support staff decisions; they are not a triage diagnosis.</p>
        {q.data?.rulesError && <Alert tone="warning" title="Routing rules file has an error">{q.data.rulesError} The last valid rules are in use.</Alert>}
        {error && <Alert tone="error">{errorMessage(error)}</Alert>}
        {q.isPending && <Spinner />}
        {q.data && !s && <p>No suggestion yet for this visit.</p>}
        {s && (
          <section aria-label="Routing suggestion" className="space-y-3">
            {s.suggestion.redFlags.map((f) => (
              <Alert key={f.id} tone="error" title={`Red flag: ${f.matched}`}>
                {f.instruction} A staff member must act on this now.
              </Alert>
            ))}
            <DescriptionList
              items={[
                ['Status', <Badge tone={s.status === 'applied' ? 'ok' : s.status === 'pending' ? 'warn' : 'neutral'}>{s.status === 'pending' ? 'Awaiting review' : s.status}</Badge>],
                ['Department', s.suggestion.departmentName ?? `${s.suggestion.departmentCode} (not available)`],
                ['Doctor', s.suggestion.doctorName ?? 'Any doctor in the department'],
                ['Priority for staff review', s.suggestion.priority === 'urgent' ? <Badge tone="down">Urgent</Badge> : 'Normal'],
                ['Missing intake', s.suggestion.missingIntake.length ? s.suggestion.missingIntake.join(', ') : 'None'],
                ['Rules', `${s.rulesVersion} · ${fmtDateTime(s.createdAt)}`],
                ...(s.reviewedAt ? ([['Reviewed', `${s.reviewedByName ?? ''} · ${fmtDateTime(s.reviewedAt)}${s.reviewReason ? ` · “${s.reviewReason}”` : ''}`]] as [string, string][]) : []),
              ]}
            />
            <div>
              <p className="font-medium">Why</p>
              <ul className="list-disc pl-5">
                {s.suggestion.reasons.map((r) => (
                  <li key={r.rule}>
                    {r.text} <span className="text-xs text-ink-muted">({r.rule})</span>
                  </li>
                ))}
              </ul>
            </div>
            {overriding && <TextAreaField label="Reason for override" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="Then use Edit on the visit to set the department, doctor or priority you chose." />}
          </section>
        )}
      </div>
    </Dialog>
  )
}
