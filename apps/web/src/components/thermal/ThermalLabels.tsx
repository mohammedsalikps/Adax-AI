import { CAPTURE_FINDINGS, LABEL_CERTAINTY, REFERENCE_STANDARDS, ROI_FINDINGS, type ThermalCapture, type ThermalLabel, type ThermalLabelInput } from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, errorMessage, issuesToErrors } from '../../lib/api.ts'
import { useMe } from '../../lib/auth.tsx'
import { fmtDateTime } from '../../lib/format.ts'
import { thermalKey } from '../../lib/thermal.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, Badge } from '../ui/Feedback.tsx'
import { SelectField, TextAreaField } from '../ui/Form.tsx'
import { Card } from '../ui/Layout.tsx'
import { useToast } from '../ui/Toast.tsx'

const ALL_FINDINGS: Record<string, string> = { ...CAPTURE_FINDINGS, ...ROI_FINDINGS }
const text = (map: Record<string, string>, k: string) => map[k] ?? k

function LabelForm({ capture }: { capture: ThermalCapture }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [scope, setScope] = useState<'capture' | 'roi'>('capture')
  const [roiLabel, setRoiLabel] = useState('')
  const [code, setCode] = useState('')
  const [referenceStandard, setReference] = useState<keyof typeof REFERENCE_STANDARDS>('clinical_impression')
  const [certainty, setCertainty] = useState<keyof typeof LABEL_CERTAINTY>('probable')
  const [note, setNote] = useState('')
  const add = useMutation({
    mutationFn: (body: ThermalLabelInput) => api<ThermalCapture>(`/thermal/${capture.id}/labels`, { method: 'POST', body }),
    onSuccess: (d) => {
      qc.setQueryData(thermalKey(d.id), d)
      setCode('')
      setNote('')
      toast('success', 'Label added')
    },
  })
  const errors = add.isError ? issuesToErrors(add.error) : {}
  const findings = scope === 'capture' ? CAPTURE_FINDINGS : ROI_FINDINGS
  return (
    <form
      className="mt-4 space-y-3 border-t border-line pt-4"
      aria-label="Add a label"
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate({ scope, roiLabel: scope === 'roi' ? roiLabel : null, code, referenceStandard, certainty, note })
      }}
    >
      <h3 className="text-sm font-semibold">Add your label</h3>
      {add.isError && !Object.keys(errors).length && <Alert tone="error">{errorMessage(add.error)}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Applies to" value={scope === 'capture' ? '' : roiLabel} error={errors.roiLabel} onChange={(e) => (setScope(e.target.value ? 'roi' : 'capture'), setRoiLabel(e.target.value), setCode(''))}>
          <option value="">Whole image</option>
          {capture.rois.map((r) => (
            <option key={r.id} value={r.label}>
              Region: {r.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Finding" required value={code} error={errors.code} onChange={(e) => setCode(e.target.value)}>
          <option value="">Choose…</option>
          {Object.entries(findings).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <SelectField label="Reference standard" hint="How the finding was established." value={referenceStandard} onChange={(e) => setReference(e.target.value as keyof typeof REFERENCE_STANDARDS)}>
          {Object.entries(REFERENCE_STANDARDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
        <SelectField label="Certainty" value={certainty} onChange={(e) => setCertainty(e.target.value as keyof typeof LABEL_CERTAINTY)}>
          {Object.entries(LABEL_CERTAINTY).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </SelectField>
      </div>
      <TextAreaField label="Note (optional)" hint="Kept in the record; never included in dataset exports." rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      <Button type="submit" disabled={!code || (scope === 'roi' && !roiLabel)} loading={add.isPending}>
        Add label
      </Button>
    </form>
  )
}

function WithdrawDialog({ capture, label, onClose }: { capture: ThermalCapture; label: ThermalLabel; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const withdraw = useMutation({
    mutationFn: () => api<ThermalCapture>(`/thermal/${capture.id}/labels/${label.id}/withdraw`, { method: 'POST', body: { reason } }),
    onSuccess: (d) => (qc.setQueryData(thermalKey(d.id), d), toast('success', 'Label withdrawn'), onClose()),
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Withdraw label"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!reason.trim()} loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
            Withdraw label
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          The label “{text(ALL_FINDINGS, label.code)}” stays on record, marked as withdrawn. You can then add a new one.
        </p>
        {withdraw.isError && <Alert tone="error">{errorMessage(withdraw.error)}</Alert>}
        <TextAreaField label="Reason" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Dialog>
  )
}

/**
 * Clinician labels on an approved image: the reference data for future
 * evaluation. Several doctors may label the same image independently.
 */
export function ThermalLabelsCard({ capture }: { capture: ThermalCapture }) {
  const { data: me } = useMe()
  const [withdrawing, setWithdrawing] = useState<ThermalLabel | null>(null)
  const isDoctor = me?.role === 'doctor'
  return (
    <Card title="Clinician labels">
      <p className="text-sm text-ink-muted">
        Labels record a doctor’s finding for building evaluation datasets. They do not change the patient’s record or the measurements. Label from your own assessment, before looking at the experimental flags.
      </p>
      {!capture.labels.length && <p className="mt-3 text-sm">No labels yet.</p>}
      <ul className="mt-3 space-y-2" data-testid="thermal-labels">
        {capture.labels.map((l) => (
          <li key={l.id} className={`rounded-md border border-line p-3 text-sm ${l.withdrawn ? 'bg-canvas text-ink-muted' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className={l.withdrawn ? 'line-through' : 'font-medium'}>
                  {l.scope === 'roi' ? `${l.roiLabel}: ` : 'Whole image: '}
                  {text(ALL_FINDINGS, l.code)}
                </p>
                <p className="text-xs text-ink-muted">
                  {text(REFERENCE_STANDARDS, l.referenceStandard)} · {text(LABEL_CERTAINTY, l.certainty)} · {l.labelledByName} · {fmtDateTime(l.labelledAt)}
                </p>
                {l.note && <p className="mt-1">{l.note}</p>}
                {l.withdrawn && (
                  <p className="mt-1 text-xs">
                    Withdrawn {fmtDateTime(l.withdrawn.at)} by {l.withdrawn.byName}: {l.withdrawn.reason}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {l.withdrawn ? <Badge>Withdrawn</Badge> : <Badge tone="ok">Active</Badge>}
                {!l.withdrawn && isDoctor && l.labelledById === me?.id && (
                  <Button size="sm" variant="secondary" onClick={() => setWithdrawing(l)}>
                    Withdraw
                  </Button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {isDoctor && <LabelForm capture={capture} />}
      {withdrawing && <WithdrawDialog capture={capture} label={withdrawing} onClose={() => setWithdrawing(null)} />}
    </Card>
  )
}
