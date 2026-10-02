import {
  DiscardDraftRequest,
  type Encounter,
  ENCOUNTER_STATUS_LABELS,
  type EncounterStatus,
  STATUS_SOURCE_LABELS,
  type StatusEvent,
  VERIFICATION_LIMITS,
  VERIFICATION_STATUS_LABELS,
  type VerificationCheck,
  VISIT_STATUS_LABELS,
  type VisitStatus,
} from '@adaxai/contracts'
import { CircleCheck, CircleMinus, CircleX, History, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../../lib/api.ts'
import { useDiscardDraft, useStatusHistory, useVerifyRecord } from '../../lib/encounters.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, Badge, Spinner } from '../ui/Feedback.tsx'
import { TextAreaField } from '../ui/Form.tsx'
import { Card } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'

/**
 * Closes an unsigned draft without signing, after saying what happens and
 * asking why. The draft is kept read-only; the visit returns to the queue.
 */
export function DiscardDraftDialog({ draft, onClose, onDiscarded }: { draft: { id: string; version: number; patientName: string; visitStatus: VisitStatus }; onClose: () => void; onDiscarded?: (e: Encounter) => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  const discard = useDiscardDraft(draft.id)
  const submit = async () => {
    const r = DiscardDraftRequest.safeParse({ version: draft.version, reason })
    if (!r.success) return setError(r.error.issues.find((i) => i.path[0] === 'reason')?.message ?? 'Check the reason')
    setError(undefined)
    // Awaited rather than per-call callbacks: the page behind may re-render into the read-only view first.
    const e = await discard.mutateAsync(r.data).catch(() => null)
    if (!e) return
    toast('success', 'Draft discarded')
    onDiscarded?.(e)
    onClose()
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title="Discard this draft?"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep the draft
          </Button>
          <Button variant="danger" loading={discard.isPending} onClick={() => void submit()}>
            Discard draft
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {discard.isError && <Alert tone="error">{errorMessage(discard.error)}</Alert>}
        <p>
          The unsigned consultation for <strong>{draft.patientName}</strong> will be closed without signing.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>It is kept, read-only, with your name, the time and your reason. It cannot be edited or signed afterwards.</li>
          <li>It does not appear in the patient’s history or in the patient portal.</li>
          {draft.visitStatus === 'in_consultation' && <li>The visit goes back to the queue as “{VISIT_STATUS_LABELS.ready}”, so a consultation can be started again.</li>}
        </ul>
        <TextAreaField label="Reason" required rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} error={error} hint="Kept with the draft and its status history, not in the audit log." />
      </div>
    </Dialog>
  )
}

const statusLabel = (subject: StatusEvent['subject'], s: string) => (subject === 'visit' ? (VISIT_STATUS_LABELS[s as VisitStatus] ?? s) : (ENCOUNTER_STATUS_LABELS[s as EncounterStatus] ?? s))

/** Status history of the consultation and its visit: loaded when opened (reading it is audited). */
export function StatusHistoryCard({ encounterId }: { encounterId: string }) {
  const [open, setOpen] = useState(false)
  const q = useStatusHistory(encounterId, open)
  return (
    <Card
      title="Status history"
      actions={
        <Button size="sm" variant="secondary" icon={<History aria-hidden="true" className="size-4" />} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Hide' : 'Show'}
        </Button>
      }
    >
      {!open && <p className="text-sm text-ink-muted">Who changed the visit and the consultation, when, how and why.</p>}
      {open && q.isPending && <Spinner />}
      {open && q.isError && <Alert tone="error">{errorMessage(q.error)}</Alert>}
      {open && q.data && (
        <ol className="space-y-3 text-sm" aria-label="Status changes">
          {q.data.map((ev, i) => (
            <li key={i} className="border-l-2 border-line pl-3">
              <p className="font-medium">
                {ev.subject === 'visit' ? 'Visit' : 'Consultation'}: {ev.from ? `${statusLabel(ev.subject, ev.from)} → ` : ''}
                {statusLabel(ev.subject, ev.to)}
              </p>
              <p className="text-xs text-ink-muted">
                {fmtDateTime(ev.at)} · {STATUS_SOURCE_LABELS[ev.source] ?? ev.source}
                {ev.actorName ? ` · ${ev.actorName}` : ev.source === 'history_start' ? '' : ' · user not recorded'}
              </p>
              {ev.reason && <p className="text-xs">Reason: {ev.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

const CHECK_ICON: Record<VerificationCheck['result'], { Icon: typeof CircleCheck; cls: string; text: string }> = {
  pass: { Icon: CircleCheck, cls: 'text-ok', text: 'Passed' },
  fail: { Icon: CircleX, cls: 'text-down', text: 'Failed' },
  not_checked: { Icon: CircleMinus, cls: 'text-ink-muted', text: 'Not checked' },
}
const RESULT_TONE = { valid: 'ok', invalid: 'down', unsupported_version: 'warn', unverifiable: 'neutral' } as const

/**
 * Re-checks the signed record against the fingerprints recorded when it was
 * signed and amended. Shows the real result of the check, with what it means
 * and does not mean; nothing is shown until the check has run.
 */
export function RecordVerificationCard({ encounterId }: { encounterId: string }) {
  const verify = useVerifyRecord(encounterId)
  const r = verify.data
  return (
    <Card
      title="Record verification"
      actions={
        <Button size="sm" variant="secondary" icon={<ShieldCheck aria-hidden="true" className="size-4" />} loading={verify.isPending} onClick={() => verify.mutate()}>
          {r ? 'Check again' : 'Check now'}
        </Button>
      }
    >
      {!r && !verify.isError && <p className="text-sm text-ink-muted">Compares the stored record, its amendments and their audit entries with the fingerprints recorded at the time.</p>}
      {verify.isError && <Alert tone="error">{errorMessage(verify.error)}</Alert>}
      <p role="status" className="sr-only">
        {r ? `Record verification: ${VERIFICATION_STATUS_LABELS[r.status]}.` : ''}
      </p>
      {r && (
        <div className="space-y-3 text-sm" data-testid="verification-result">
          <p className="flex flex-wrap items-center gap-2">
            <Badge tone={RESULT_TONE[r.status]}>{VERIFICATION_STATUS_LABELS[r.status]}</Badge>
            <span className="text-xs text-ink-muted">Checked {fmtDateTime(r.checkedAt)}</span>
          </p>
          <ul className="space-y-2" aria-label="Verification checks">
            {r.checks.map((c) => {
              const { Icon, cls, text } = CHECK_ICON[c.result]
              return (
                <li key={c.key} className="flex gap-2">
                  <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${cls}`} />
                  <div className="min-w-0">
                    <p className="font-medium">
                      {c.label} <span className={`text-xs font-normal ${cls}`}>({text})</span>
                    </p>
                    <p className="text-xs text-ink-muted">{c.detail}</p>
                  </div>
                </li>
              )
            })}
          </ul>
          {r.notes.length > 0 && (
            <Alert tone="info" title="Changed since then (not part of the check)">
              <ul className="list-disc pl-4">
                {r.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </Alert>
          )}
          {r.scheme && <p className="text-xs text-ink-muted">Fingerprint version: {r.scheme}</p>}
          <p className="text-xs text-ink-muted">{VERIFICATION_LIMITS}</p>
        </div>
      )}
    </Card>
  )
}
