import { type Consent, CONSENT_LABELS, CONSENT_STATES, CONSENT_VERSIONS, CONSENT_WITHDRAWAL_EFFECTS, type ConsentSummary, type ConsentType, consentWording, type PatientDetail, type RecordConsentRequest, type WithdrawConsentRequest } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api.ts'
import { patientKey, usePatientMutation } from '../../lib/clinical.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, Badge } from '../ui/Feedback.tsx'
import { SelectField, TextField } from '../ui/Form.tsx'
import { Card } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'

const STATE_TONE: Record<ConsentSummary['state'], 'ok' | 'warn' | 'neutral'> = { granted: 'ok', outdated: 'warn', withdrawn: 'neutral', not_recorded: 'neutral' }
const STATUS_LABEL: Record<Consent['status'], string> = { granted: 'Granted', withdrawn: 'Withdrawn', superseded: 'Replaced by a renewal' }
const via = (v: string | null) => (v === 'patient_portal' ? 'by the patient in the portal' : v === 'staff' ? 'by staff' : '')

/** Record (or renew) a consent after reading the current wording to the patient. */
function RecordDialog({ p, type, renewing, onClose }: { p: PatientDetail; type: ConsentType; renewing: Consent | null; onClose: () => void }) {
  const toast = useToast()
  const [method, setMethod] = useState<'verbal' | 'written'>('verbal')
  const grant = usePatientMutation<RecordConsentRequest>(p.id, '/consents')
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${renewing ? 'Renew' : 'Record'} consent: ${CONSENT_LABELS[type].title}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={grant.isPending} onClick={() => grant.mutate({ type, method }, { onSuccess: () => (toast('success', renewing ? 'Consent renewed with the current wording' : 'Consent recorded'), onClose()) })}>
            Patient agrees
          </Button>
        </>
      }
    >
      {grant.isError && <Alert tone="error" className="mb-3">{errorMessage(grant.error)}</Alert>}
      {renewing && (
        <Alert tone="warning" className="mb-3">
          The patient agreed to an earlier wording ({renewing.version}). Some features need the current wording ({CONSENT_VERSIONS[type]}).
        </Alert>
      )}
      <p className="text-sm">Explain to the patient, in their language:</p>
      <blockquote className="my-3 border-l-4 border-brand pl-3 text-sm">{CONSENT_LABELS[type].description}</blockquote>
      <p className="mb-3 text-sm">The patient can withdraw at any time, also in the patient portal. Record consent only if they agree.</p>
      <SelectField label="How was consent given?" value={method} onChange={(e) => setMethod(e.target.value as 'verbal')}>
        <option value="verbal">Verbal</option>
        <option value="written">Written (signed form)</option>
      </SelectField>
    </Dialog>
  )
}

/** Withdraw a purpose: shows what changes at once; the reason is optional and stays on the record. */
function WithdrawDialog({ p, consent, onClose }: { p: PatientDetail; consent: Consent; onClose: () => void }) {
  const toast = useToast()
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const withdraw = useMutation({
    mutationFn: (body: WithdrawConsentRequest) => api<PatientDetail>(`/patients/${p.id}/consents/${consent.id}/withdraw`, { method: 'POST', body }),
    onSuccess: (d) => {
      qc.setQueryData(patientKey(p.id), d)
      toast('success', 'Consent withdrawn')
      onClose()
    },
  })
  const effect = CONSENT_WITHDRAWAL_EFFECTS[consent.type]
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Withdraw consent: ${CONSENT_LABELS[consent.type].title}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={withdraw.isPending} onClick={() => withdraw.mutate({ reason: reason.trim() || null })}>
            Withdraw consent
          </Button>
        </>
      }
    >
      {withdraw.isError && <Alert tone="error" className="mb-3">{errorMessage(withdraw.error)}</Alert>}
      <p className="text-sm">The withdrawal is recorded at once and ends every grant of this purpose, including consultation-only ones.</p>
      <Alert tone="warning" className="my-3">
        {effect}
      </Alert>
      <TextField label="Reason (optional)" hint="Kept with the consent record; not copied into the audit log." maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
    </Dialog>
  )
}

/**
 * What the patient agreed to, purpose by purpose: granted (current wording),
 * granted under an earlier wording (renew), withdrawn, or not recorded; with
 * the full history, including consultation-only grants and renewals.
 */
export function ConsentsCard({ p }: { p: PatientDetail }) {
  const [recording, setRecording] = useState<{ type: ConsentType; renewing: Consent | null } | null>(null)
  const [withdrawing, setWithdrawing] = useState<Consent | null>(null)
  const types = Object.keys(CONSENT_LABELS) as ConsentType[]
  return (
    <Card title="Consents">
      <ul className="divide-y divide-line">
        {types.map((t) => {
          const s = p.consentStates.find((x) => x.type === t)
          const state = s?.state ?? 'not_recorded'
          const active = s?.consentId ? (p.consents.find((c) => c.id === s.consentId) ?? null) : null
          // A consultation-only grant can be active without an ongoing one; it can be withdrawn too.
          const anyActive = active ?? p.consents.find((c) => c.type === t && c.status === 'granted') ?? null
          const lastWithdrawn = state === 'withdrawn' ? p.consents.find((c) => c.type === t && c.status === 'withdrawn') : null
          return (
            <li key={t} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0" data-testid={`consent-${t}`}>
              <div className="min-w-0 max-w-md">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {CONSENT_LABELS[t].title} <Badge tone={STATE_TONE[state]}>{CONSENT_STATES[state]}</Badge>
                </p>
                <p className="text-xs text-ink-muted">{CONSENT_LABELS[t].description}</p>
                {active && (
                  <p className="mt-1 text-xs text-ink-muted">
                    {active.method} · {fmtDateTime(active.recordedAt)} · {active.recordedByName ?? 'patient'} · wording {active.version}
                  </p>
                )}
                {!active && anyActive && <p className="mt-1 text-xs text-ink-muted">Granted for one consultation only ({fmtDateTime(anyActive.recordedAt)}).</p>}
                {lastWithdrawn && (
                  <p className="mt-1 text-xs text-ink-muted">
                    Withdrawn {fmtDateTime(lastWithdrawn.withdrawnAt)} {via(lastWithdrawn.withdrawnVia)}
                    {lastWithdrawn.withdrawnByName && ` (${lastWithdrawn.withdrawnByName})`}
                    {lastWithdrawn.withdrawReason && ` · reason: ${lastWithdrawn.withdrawReason}`}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {state === 'outdated' && active && (
                  <Button size="sm" variant="secondary" onClick={() => setRecording({ type: t, renewing: active })}>
                    Renew consent
                  </Button>
                )}
                {anyActive && (
                  <Button size="sm" variant="ghost" onClick={() => setWithdrawing(anyActive)}>
                    Withdraw…
                  </Button>
                )}
                {!active && (
                  <Button size="sm" variant="secondary" onClick={() => setRecording({ type: t, renewing: null })}>
                    Record consent
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      {p.consents.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-medium text-ink-muted">Consent history ({p.consents.length} records)</summary>
          <ol className="mt-2 space-y-2">
            {p.consents.map((c) => (
              <li key={c.id} className="rounded-md border border-line p-2 text-xs">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {(consentWording(c.type, c.version) ?? CONSENT_LABELS[c.type]).title}
                  <Badge tone={c.status === 'granted' ? 'ok' : 'neutral'}>{STATUS_LABEL[c.status]}</Badge>
                  {c.scope === 'encounter' && <Badge>One consultation</Badge>}
                  {!c.currentWording && <Badge tone="warn">Earlier wording {c.version}</Badge>}
                </p>
                <p className="text-ink-muted">
                  Recorded {fmtDateTime(c.recordedAt)} · {c.method} · {c.recordedByName ?? 'patient'}
                  {c.withdrawnAt && ` · withdrawn ${fmtDateTime(c.withdrawnAt)} ${via(c.withdrawnVia)}${c.withdrawnByName ? ` (${c.withdrawnByName})` : ''}`}
                  {c.withdrawReason && ` · reason: ${c.withdrawReason}`}
                </p>
              </li>
            ))}
          </ol>
        </details>
      )}
      {recording && <RecordDialog p={p} type={recording.type} renewing={recording.renewing} onClose={() => setRecording(null)} />}
      {withdrawing && <WithdrawDialog p={p} consent={withdrawing} onClose={() => setWithdrawing(null)} />}
    </Card>
  )
}
