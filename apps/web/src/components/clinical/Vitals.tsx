import { type Observation, RecordVitalsRequest, VITAL_ORDER, VITALS, type VitalFlag, type VitalKind } from '@adaxai/contracts'
import { ArrowDown, ArrowUp, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../../lib/api.ts'
import { useVisitMutation } from '../../lib/clinical.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert } from '../ui/Feedback.tsx'
import { TextField } from '../ui/Form.tsx'
import { useToast } from '../ui/Toast.tsx'

const FLAG_TEXT: Record<VitalFlag, string> = { normal: '', low: 'Low', high: 'High', critical_low: 'Very low', critical_high: 'Very high' }

export const fmtValue = (o: Pick<Observation, 'kind' | 'value'>) => o.value.toFixed(VITALS[o.kind].decimals)

/** Flag shown as text + icon (not colour alone). Reference-range flags are a display aid, not a diagnosis. */
export function FlagLabel({ flag }: { flag: VitalFlag | null }) {
  if (!flag || flag === 'normal') return null
  const critical = flag.startsWith('critical')
  const Icon = critical ? TriangleAlert : flag.endsWith('low') ? ArrowDown : ArrowUp
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${critical ? 'text-down' : 'text-pending'}`}>
      <Icon aria-hidden="true" className="size-3" />
      {FLAG_TEXT[flag]}
    </span>
  )
}

/** Compact latest-vitals line for queue rows. */
export function VitalsInline({ vitals }: { vitals: Observation[] }) {
  if (!vitals.length) return <span className="text-sm text-ink-muted">No vitals yet</span>
  const sorted = [...vitals].sort((a, b) => VITAL_ORDER.indexOf(a.kind) - VITAL_ORDER.indexOf(b.kind))
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums">
      {sorted.map((o) => (
        <li key={o.id} className={o.flag && o.flag !== 'normal' ? 'font-medium' : ''}>
          <span className="text-ink-muted">{VITALS[o.kind].short}</span> {fmtValue(o)}
          <span className="text-xs text-ink-muted"> {o.unit}</span> <FlagLabel flag={o.flag} />
        </li>
      ))}
    </ul>
  )
}

const ENTRY_KINDS: VitalKind[] = ['temperature', 'heart_rate', 'respiratory_rate', 'systolic_bp', 'diastolic_bp', 'spo2', 'blood_glucose', 'pain_score', 'weight', 'height']

/** Nurse/doctor vitals entry. Empty fields are skipped; ranges are validated on both client and server. */
export function RecordVitalsDialog({ visitId, patientName, onClose }: { visitId: string; patientName: string; onClose: () => void }) {
  const toast = useToast()
  const [values, setValues] = useState<Partial<Record<VitalKind, string>>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useVisitMutation<RecordVitalsRequest>(visitId, '/observations')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const items = ENTRY_KINDS.filter((k) => values[k]?.trim()).map((kind) => ({ kind, value: Number(values[kind]) }))
    const parsed = RecordVitalsRequest.safeParse({ items })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const i of parsed.error.issues) {
        const idx = i.path[1]
        const item = typeof idx === 'number' ? items[idx] : undefined
        const key = item ? item.kind : '_form'
        next[key] ??= item && Number.isNaN(item.value) ? 'Enter a number' : i.message
      }
      setErrors(next)
      return
    }
    save.mutate(parsed.data, {
      onSuccess: () => {
        toast('success', `Vitals saved for ${patientName}`)
        onClose()
      },
      onError: (err) => {
        const issues = (err as { issues?: { path: string; message: string }[] }).issues ?? []
        setErrors(Object.fromEntries(issues.map((i) => [items[Number(i.path.split('.')[1])]?.kind ?? '_form', i.message])))
      },
    })
  }

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Record vitals — ${patientName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="vitals-form" loading={save.isPending}>
            Save vitals
          </Button>
        </>
      }
    >
      <form id="vitals-form" noValidate onSubmit={submit} className="space-y-4">
        <p className="text-sm text-ink-muted">Enter the measurements you took; leave the rest blank. Values are recorded as manual entries by you.</p>
        {errors._form && <Alert tone="error">{errors._form}</Alert>}
        {save.isError && !Object.keys(errors).length && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ENTRY_KINDS.map((kind) => {
            const d = VITALS[kind]
            return (
              <TextField
                key={kind}
                label={`${d.label} (${d.unit})`}
                inputMode="decimal"
                autoComplete="off"
                value={values[kind] ?? ''}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [kind]: e.target.value }))
                  setErrors(({ [kind]: _x, ...rest }) => rest)
                }}
                error={errors[kind]}
                hint={d.reference ? `Adult reference ${d.reference[0]}–${d.reference[1]}` : undefined}
              />
            )
          })}
        </div>
      </form>
    </Dialog>
  )
}
