import type { ActivationCodeResponse, PatientDetail } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { KeyRound, PowerOff } from 'lucide-react'
import { useState } from 'react'
import { api, errorMessage } from '../../lib/api.ts'
import { patientKey } from '../../lib/clinical.ts'
import { fmtDateTime } from '../../lib/format.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, Badge } from '../ui/Feedback.tsx'
import { Card } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'

/**
 * The patient's portal account: activation code for a new account, reset
 * code for an existing one (new password; also switches a switched-off
 * account back on), and switching the account off at once. Codes need the
 * patient's portal consent.
 */
export function PortalAccountCard({ p }: { p: PatientDetail }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [code, setCode] = useState<ActivationCodeResponse | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)
  const issue = useMutation({
    mutationFn: () => api<ActivationCodeResponse>(`/patients/${p.id}/portal-activation`, { method: 'POST' }),
    onSuccess: (r) => (setCode(r), void qc.invalidateQueries({ queryKey: patientKey(p.id) })),
  })
  const disable = useMutation({
    mutationFn: () => api<PatientDetail>(`/patients/${p.id}/portal-account/disable`, { method: 'POST' }),
    onSuccess: (d) => (qc.setQueryData(patientKey(p.id), d), setConfirmOff(false), toast('success', 'Portal account switched off; the patient was signed out')),
  })
  const consent = p.consentStates.find((s) => s.type === 'portal_access')?.state
  const consented = consent === 'granted' || consent === 'outdated'
  const state = p.portalAccount.state
  return (
    <Card title="Patient portal">
      <div className="space-y-3 text-sm">
        {state === 'active' && (
          <p>
            <Badge tone="ok">Active</Badge> The patient signs in with MRN <span className="font-mono">{p.mrn}</span>.
          </p>
        )}
        {state === 'deactivated' && (
          <Alert tone="warning" title="Account switched off">
            The patient cannot sign in. A reset code (after the patient consents to portal access) switches it back on with a new password.
          </Alert>
        )}
        {state === 'none' && <p>{p.portalAccount.activationPending ? 'An activation code has been issued and not used yet.' : 'No portal account yet.'}</p>}
        {state !== 'none' && p.portalAccount.activationPending && <p className="text-ink-muted">A reset code has been issued and not used yet.</p>}
        {!consented && <Alert tone="info">{consent === 'withdrawn' ? 'The patient withdrew consent to portal access.' : 'Record the patient’s consent to portal access first.'}</Alert>}
        {issue.isError && <Alert tone="error">{errorMessage(issue.error)}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon={<KeyRound aria-hidden="true" className="size-4" />} disabled={!consented} loading={issue.isPending} onClick={() => issue.mutate()}>
            {state === 'none' ? (p.portalAccount.activationPending ? 'Issue a new code' : 'Issue activation code') : 'Issue reset code'}
          </Button>
          {state === 'active' && (
            <Button size="sm" variant="ghost" icon={<PowerOff aria-hidden="true" className="size-4" />} onClick={() => setConfirmOff(true)}>
              Switch account off
            </Button>
          )}
        </div>
      </div>
      {code && (
        <Dialog open onClose={() => setCode(null)} title={code.reset ? 'Reset code' : 'Activation code'} footer={<Button onClick={() => setCode(null)}>Done</Button>}>
          <p className="text-sm">
            Give the patient their MRN and this code. It works once and expires {fmtDateTime(code.expiresAt)}. It will not be shown again.
            {code.reset && ' The patient chooses a new password; the old password and any open sessions stop working.'}
          </p>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-line bg-canvas p-3">
            <dt className="text-sm text-ink-muted">MRN</dt>
            <dd className="font-mono text-lg">{code.mrn}</dd>
            <dt className="text-sm text-ink-muted">Code</dt>
            <dd className="font-mono text-lg select-all" data-testid="activation-code">
              {code.activationCode}
            </dd>
          </dl>
          <p className="mt-3 text-sm">The patient uses it at the sign-in page → “Activate your account”.</p>
        </Dialog>
      )}
      {confirmOff && (
        <Dialog
          open
          onClose={() => setConfirmOff(false)}
          title="Switch the portal account off?"
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmOff(false)}>
                Cancel
              </Button>
              <Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate()}>
                Switch off now
              </Button>
            </>
          }
        >
          {disable.isError && <Alert tone="error" className="mb-3">{errorMessage(disable.error)}</Alert>}
          <p className="text-sm">The patient is signed out at once and cannot sign in until a reset code is used. Use this when, for example, someone else may know the password.</p>
        </Dialog>
      )}
    </Card>
  )
}
