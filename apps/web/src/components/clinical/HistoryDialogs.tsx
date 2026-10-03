import { AllergyInput, ConditionInput, InvestigationInput, MedicationInput } from '@adaxai/contracts'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { z } from 'zod'
import { errorMessage, issuesToErrors } from '../../lib/api.ts'
import { useAddAllergy, useAddCondition, useAddInvestigation, useAddMedication } from '../../lib/history.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert } from '../ui/Feedback.tsx'
import { SelectField, TextAreaField, TextField } from '../ui/Form.tsx'
import { useToast } from '../ui/Toast.tsx'

const todayIso = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Field errors from a failed parse, keyed by field name. */
function issuesOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const i of error.issues) out[i.path.join('.') || '_form'] ??= i.message
  return out
}

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))

/**
 * One request at a time. A mutation's "pending" state is a state update, so a second Enter can arrive before the first save is shown as
 * pending; this is a synchronous latch. `begin()` says whether to go ahead; `end()` (when the request settles) opens it again.
 */
function useSingleFlight() {
  const inFlight = useRef(false)
  return {
    begin: () => {
      if (inFlight.current) return false
      inFlight.current = true
      return true
    },
    end: () => {
      inFlight.current = false
    },
  }
}

/** The shell every entry dialog shares: title, the fields, a cancel and a save that cannot be sent twice. */
function EntryDialog({ title, children, onClose, onSave, saving, error, saveLabel = 'Save' }: { title: string; children: ReactNode; onClose: () => void; onSave: () => void; saving: boolean; error: unknown; saveLabel?: string }) {
  // Enter pressed again while a save is under way must not send a second request.
  const save = () => {
    if (!saving) onSave()
  }
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      dismissible={!saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {saveLabel}
          </Button>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="space-y-4"
      >
        {error != null && Object.keys(issuesToErrors(error)).length === 0 && <Alert tone="error">{errorMessage(error)}</Alert>}
        {children}
        {/* Enter in a field saves, as in every other form. */}
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true" />
      </form>
    </Dialog>
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function AddConditionDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const toast = useToast()
  const add = useAddCondition(patientId)
  const flight = useSingleFlight()
  const [v, setV] = useState({ name: '', code: '', sinceYear: '', sinceMonth: '', status: 'active', note: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (k: keyof typeof v, value: string) => {
    setV((x) => ({ ...x, [k]: value }))
    setErrors((e) => ({ ...e, [k]: '' }))
  }
  const save = () => {
    const parsed = ConditionInput.safeParse({ name: v.name, code: v.code, sinceYear: num(v.sinceYear) ?? Number.NaN, sinceMonth: num(v.sinceMonth), status: v.status, note: v.note })
    if (!parsed.success) return setErrors(issuesOf(parsed.error))
    if (!flight.begin()) return
    add.mutate(parsed.data, {
      onSettled: flight.end,
      onSuccess: () => {
        toast('success', 'Condition added')
        onClose()
      },
      onError: (e) => setErrors(issuesToErrors(e)),
    })
  }
  return (
    <EntryDialog title="Add a known condition" onClose={onClose} onSave={save} saving={add.isPending} error={add.error}>
      <TextField label="Condition" value={v.name} onChange={(e) => set('name', e.target.value)} error={errors.name} required maxLength={120} autoFocus />
      <TextField label="ICD-10 code (optional)" value={v.code} onChange={(e) => set('code', e.target.value)} error={errors.code} hint="For example E11.9" spellCheck={false} maxLength={12} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Since (year)" type="number" inputMode="numeric" value={v.sinceYear} onChange={(e) => set('sinceYear', e.target.value)} error={errors.sinceYear} required min={1900} max={new Date().getFullYear()} />
        <SelectField label="Month (optional)" value={v.sinceMonth} onChange={(e) => set('sinceMonth', e.target.value)} error={errors.sinceMonth}>
          <option value="">Not known</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>
              {m}
            </option>
          ))}
        </SelectField>
      </div>
      <SelectField label="Status" value={v.status} onChange={(e) => set('status', e.target.value)}>
        <option value="active">Active</option>
        <option value="controlled">Controlled</option>
        <option value="resolved">Resolved</option>
      </SelectField>
      <TextAreaField label="Note (optional)" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} error={errors.note} maxLength={300} />
    </EntryDialog>
  )
}

export function AddMedicationDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const toast = useToast()
  const add = useAddMedication(patientId)
  const flight = useSingleFlight()
  const [v, setV] = useState({ drugName: '', strength: '', form: '', dose: '', route: 'Oral', frequency: '', startedOn: '', reason: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (k: keyof typeof v, value: string) => {
    setV((x) => ({ ...x, [k]: value }))
    setErrors((e) => ({ ...e, [k]: '' }))
  }
  const save = () => {
    const parsed = MedicationInput.safeParse({ ...v, startedOn: v.startedOn || null })
    if (!parsed.success) return setErrors(issuesOf(parsed.error))
    if (!flight.begin()) return
    add.mutate(parsed.data, {
      onSettled: flight.end,
      onSuccess: () => {
        toast('success', 'Medicine added to the list')
        onClose()
      },
      onError: (e) => setErrors(issuesToErrors(e)),
    })
  }
  return (
    <EntryDialog title="Add a medicine the patient takes" onClose={onClose} onSave={save} saving={add.isPending} error={add.error}>
      <TextField label="Medicine" value={v.drugName} onChange={(e) => set('drugName', e.target.value)} error={errors.drugName} required maxLength={120} autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Strength" placeholder="500 mg" value={v.strength} onChange={(e) => set('strength', e.target.value)} error={errors.strength} maxLength={60} />
        <TextField label="Form" placeholder="Tablet" value={v.form} onChange={(e) => set('form', e.target.value)} error={errors.form} maxLength={40} />
        <TextField label="Dose" placeholder="1 tablet" value={v.dose} onChange={(e) => set('dose', e.target.value)} error={errors.dose} required maxLength={60} />
        <TextField label="Route" value={v.route} onChange={(e) => set('route', e.target.value)} error={errors.route} maxLength={30} />
      </div>
      <TextField label="Frequency" placeholder="Twice daily" value={v.frequency} onChange={(e) => set('frequency', e.target.value)} error={errors.frequency} required maxLength={60} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Started on (optional)" type="date" value={v.startedOn} max={todayIso()} onChange={(e) => set('startedOn', e.target.value)} error={errors.startedOn} />
        <TextField label="What it is for (optional)" value={v.reason} onChange={(e) => set('reason', e.target.value)} error={errors.reason} maxLength={200} />
      </div>
    </EntryDialog>
  )
}

export function AddResultDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const toast = useToast()
  const add = useAddInvestigation(patientId)
  const flight = useSingleFlight()
  const [v, setV] = useState({ testName: '', valueText: '', unit: '', refLow: '', refHigh: '', refText: '', interpretation: '', collectedOn: todayIso(), resultedOn: '', note: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (k: keyof typeof v, value: string) => {
    setV((x) => ({ ...x, [k]: value }))
    setErrors((e) => ({ ...e, [k]: '' }))
  }
  const save = () => {
    const parsed = InvestigationInput.safeParse({
      testName: v.testName,
      valueText: v.valueText,
      unit: v.unit,
      refLow: num(v.refLow),
      refHigh: num(v.refHigh),
      refText: v.refText,
      interpretation: v.interpretation || null,
      collectedOn: v.collectedOn,
      resultedOn: v.resultedOn || null,
      note: v.note,
    })
    if (!parsed.success) return setErrors(issuesOf(parsed.error))
    if (!flight.begin()) return
    add.mutate(parsed.data, {
      onSettled: flight.end,
      onSuccess: () => {
        toast('success', 'Result added')
        onClose()
      },
      onError: (e) => setErrors(issuesToErrors(e)),
    })
  }
  return (
    <EntryDialog title="Add an investigation result" onClose={onClose} onSave={save} saving={add.isPending} error={add.error}>
      <p className="text-sm text-ink-muted">
        Results are typed in by staff; there is no laboratory feed. Enter them as they appear on the report. A plain number (7.2) is compared with the lower and upper limits; a result with a symbol in it (7.2 %, &lt;5) or without limits is shown as “not compared with a range”, unless you give a reading.
      </p>
      <TextField label="Test" value={v.testName} onChange={(e) => set('testName', e.target.value)} error={errors.testName} required maxLength={120} autoFocus />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Result as it reads" placeholder="7.2" value={v.valueText} onChange={(e) => set('valueText', e.target.value)} error={errors.valueText} required maxLength={60} hint="A plain number is compared with the range" />
        <TextField label="Unit" placeholder="%" value={v.unit} onChange={(e) => set('unit', e.target.value)} error={errors.unit} maxLength={20} />
        <SelectField label="Reading (when it is not a number)" value={v.interpretation} onChange={(e) => set('interpretation', e.target.value)}>
          <option value="">Not stated</option>
          <option value="normal">Normal</option>
          <option value="abnormal">Abnormal</option>
        </SelectField>
        <TextField label="Lower limit" type="number" inputMode="decimal" step="any" value={v.refLow} onChange={(e) => set('refLow', e.target.value)} error={errors.refLow} />
        <TextField label="Upper limit" type="number" inputMode="decimal" step="any" value={v.refHigh} onChange={(e) => set('refHigh', e.target.value)} error={errors.refHigh} />
      </div>
      <TextField label="Range as it reads (optional)" placeholder="Less than 5.7" value={v.refText} onChange={(e) => set('refText', e.target.value)} error={errors.refText} maxLength={60} />
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Collected on" type="date" value={v.collectedOn} max={todayIso()} onChange={(e) => set('collectedOn', e.target.value)} error={errors.collectedOn} required />
        <TextField label="Resulted on (optional)" type="date" value={v.resultedOn} max={todayIso()} onChange={(e) => set('resultedOn', e.target.value)} error={errors.resultedOn} />
      </div>
      <TextAreaField label="Note (optional)" rows={2} value={v.note} onChange={(e) => set('note', e.target.value)} error={errors.note} maxLength={300} />
    </EntryDialog>
  )
}

export function AddAllergyDialog({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  const toast = useToast()
  const add = useAddAllergy(patientId)
  const flight = useSingleFlight()
  const [v, setV] = useState({ substance: '', reaction: '', severity: 'unknown' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (k: keyof typeof v, value: string) => {
    setV((x) => ({ ...x, [k]: value }))
    setErrors((e) => ({ ...e, [k]: '' }))
  }
  const save = () => {
    const parsed = AllergyInput.safeParse(v)
    if (!parsed.success) return setErrors(issuesOf(parsed.error))
    if (!flight.begin()) return
    add.mutate(parsed.data, {
      onSettled: flight.end,
      onSuccess: () => {
        toast('success', 'Allergy recorded')
        onClose()
      },
      onError: (e) => setErrors(issuesToErrors(e)),
    })
  }
  return (
    <EntryDialog title="Record an allergy" onClose={onClose} onSave={save} saving={add.isPending} error={add.error}>
      <TextField label="Substance" value={v.substance} onChange={(e) => set('substance', e.target.value)} error={errors.substance} required maxLength={120} autoFocus />
      <TextField label="Reaction (optional)" value={v.reaction} onChange={(e) => set('reaction', e.target.value)} error={errors.reaction} maxLength={200} />
      <SelectField label="Severity" value={v.severity} onChange={(e) => set('severity', e.target.value)}>
        <option value="unknown">Not known</option>
        <option value="mild">Mild</option>
        <option value="moderate">Moderate</option>
        <option value="severe">Severe</option>
      </SelectField>
    </EntryDialog>
  )
}

/** A reason (and for a medicine that is stopped, the date) for a change to an entry: stopping it, or marking it as entered in error. */
export function ReasonDialog({
  title,
  entry,
  intro,
  confirmLabel,
  withDate,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  title: string
  /** The entry this is about, as it reads on the list (date, value, who entered it): two entries can have the same name. */
  entry: string
  intro: ReactNode
  confirmLabel: string
  /** Ask for the date it stopped. */
  withDate?: boolean
  pending: boolean
  error: unknown
  onClose: () => void
  onConfirm: (reason: string, date: string | null) => void
}) {
  const [reason, setReason] = useState('')
  const [date, setDate] = useState(todayIso())
  const [problem, setProblem] = useState('')
  const flight = useSingleFlight()
  // The request this dialog started has settled: it can be sent again (for example after an error).
  useEffect(() => {
    if (!pending) flight.end()
  }, [pending])
  const confirm = () => {
    if (reason.trim().length < 3) return setProblem('Give a short reason (at least 3 characters)')
    if (!flight.begin()) return
    onConfirm(reason.trim(), withDate ? date || null : null)
  }
  const serverIssues = issuesToErrors(error)
  return (
    <EntryDialog title={title} onClose={onClose} onSave={confirm} saving={pending} error={error} saveLabel={confirmLabel}>
      <p className="rounded-lg bg-canvas px-3 py-2 text-sm" data-testid="reason-entry">
        <span className="block text-xs font-semibold tracking-wide text-ink-muted uppercase">Entry</span>
        {entry}
      </p>
      <p className="text-sm text-ink-muted">{intro}</p>
      {withDate && <TextField label="Stopped on" type="date" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} error={serverIssues.stoppedOn} />}
      <TextAreaField
        label="Reason"
        rows={2}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value)
          setProblem('')
        }}
        error={problem || serverIssues.reason}
        required
        maxLength={200}
        autoFocus
      />
    </EntryDialog>
  )
}
