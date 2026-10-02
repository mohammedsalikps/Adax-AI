import {
  AmendmentRequest,
  type DiagnosisInput,
  type Encounter,
  FREQUENCY_PRESETS,
  INSERTION_SUBJECTS,
  NOTE_SECTIONS,
  type NoteInsertion,
  type NoteFields,
  type PrescriptionItemInput,
  signIssues,
} from '@adaxai/contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, CloudUpload, FilePlus2, LoaderCircle, Plus, Printer, Sparkles, Trash2 } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { PatientBanner } from '../../components/clinical/PatientBanner.tsx'
import { Timeline } from '../../components/clinical/Timeline.tsx'
import { RecordVitalsDialog, VitalsInline } from '../../components/clinical/Vitals.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Dialog } from '../../components/ui/Dialog.tsx'
import { Alert, Badge, Spinner } from '../../components/ui/Feedback.tsx'
import { CheckboxField, SelectField, TextAreaField, TextField } from '../../components/ui/Form.tsx'
import { Card } from '../../components/ui/Layout.tsx'
import { useToast } from '../../components/ui/Toast.tsx'
import { ApiError, api, errorMessage } from '../../lib/api.ts'
import { useMe } from '../../lib/auth.tsx'
import { usePortalBase } from '../../lib/clinical.ts'
import { encounterKey, useEncounter } from '../../lib/encounters.ts'
import { fmtDate, fmtDateTime, fmtTime } from '../../lib/format.ts'
import type { NoteInserter } from '../../lib/insert.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'

export interface Draft {
  note: NoteFields
  diagnoses: DiagnosisInput[]
  prescription: PrescriptionItemInput[]
}

/** Lets other panels (Mana, the AI assistant) insert reviewed AI text into the note, recorded on the server. */
export type SidePanel = (e: Encounter, inserter: NoteInserter) => ReactNode

/** Where AI-produced text in the note came from (shown while editing, before signing and on the signed record). */
export function AiProvenance({ insertions, section }: { insertions: NoteInsertion[]; section?: keyof NoteFields }) {
  const list = section ? insertions.filter((i) => i.section === section) : insertions
  if (!list.length) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs" aria-label={section ? 'AI-assisted text in this section' : 'AI-assisted text in this note'}>
      {list.map((i) => (
        <li key={i.id} className="text-ai">
          <Sparkles aria-hidden="true" className="mr-1 inline size-3" />
          {section ? '' : `${NOTE_SECTIONS.find((s) => s.key === i.section)?.label}: `}AI-assisted text from {INSERTION_SUBJECTS[i.subjectType].toLowerCase()}
          {i.producedBy && ` (${i.producedBy})`}, inserted {fmtDateTime(i.insertedAt)}
          {i.insertedByName && ` by ${i.insertedByName}`} · {i.retained ? 'unchanged in the note' : 'edited or removed since'}
        </li>
      ))}
    </ul>
  )
}

type SaveState = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict'

const emptyRx = (): PrescriptionItemInput => ({ drugName: '', strength: '', form: '', dose: '', route: 'Oral', frequency: '', duration: '', instructions: '' })

function SaveIndicator({ state, savedAt }: { state: SaveState; savedAt: Date | null }) {
  const map: Record<SaveState, { icon: ReactNode; text: string; cls: string }> = {
    saved: { icon: <CircleCheck aria-hidden="true" className="size-4" />, text: savedAt ? `Saved ${fmtTime(savedAt.toISOString())}` : 'No changes', cls: 'text-ok' },
    dirty: { icon: <CloudUpload aria-hidden="true" className="size-4" />, text: 'Unsaved changes', cls: 'text-ink-muted' },
    saving: { icon: <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />, text: 'Saving…', cls: 'text-ink-muted' },
    error: { icon: <CircleAlert aria-hidden="true" className="size-4" />, text: 'Not saved — retrying', cls: 'text-down' },
    conflict: { icon: <CircleAlert aria-hidden="true" className="size-4" />, text: 'Changed elsewhere', cls: 'text-down' },
  }
  const m = map[state]
  return (
    <p role="status" aria-live="polite" className={`inline-flex items-center gap-1.5 text-sm font-medium ${m.cls}`} data-testid="save-state">
      {m.icon}
      {m.text}
    </p>
  )
}

function DiagnosesEditor({ items, onChange }: { items: DiagnosisInput[]; onChange: (next: DiagnosisInput[]) => void }) {
  const set = (i: number, patch: Partial<DiagnosisInput>) => onChange(items.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  return (
    <Card title="Diagnosis" actions={<Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => onChange([...items, { description: '', code: '', kind: items.length ? 'secondary' : 'primary' }])}>Add diagnosis</Button>}>
      {!items.length && <p className="text-sm text-ink-muted">No diagnosis yet. At least one is needed to sign (provisional is fine).</p>}
      <ul className="space-y-3">
        {items.map((d, i) => (
          <li key={i} className="grid grid-cols-1 gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_8rem_9rem_auto] sm:items-end">
            <TextField label={`Diagnosis ${i + 1}`} value={d.description ?? ''} onChange={(e) => set(i, { description: e.target.value })} />
            <TextField label="ICD-10 (optional)" value={d.code ?? ''} onChange={(e) => set(i, { code: e.target.value })} spellCheck={false} />
            <SelectField label="Type" value={d.kind ?? 'primary'} onChange={(e) => set(i, { kind: e.target.value as DiagnosisInput['kind'] })}>
              <option value="provisional">Provisional</option>
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
            </SelectField>
            <Button variant="ghost" aria-label={`Remove diagnosis ${i + 1}`} icon={<Trash2 aria-hidden="true" className="size-4" />} onClick={() => onChange(items.filter((_, j) => j !== i))} />
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-muted">ICD-10 codes are checked for format only; they are not looked up in a code set.</p>
    </Card>
  )
}

function PrescriptionEditor({ items, onChange }: { items: PrescriptionItemInput[]; onChange: (next: PrescriptionItemInput[]) => void }) {
  const set = (i: number, patch: Partial<PrescriptionItemInput>) => onChange(items.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  return (
    <Card title="Prescription" actions={<Button size="sm" variant="secondary" icon={<Plus aria-hidden="true" className="size-4" />} onClick={() => onChange([...items, emptyRx()])}>Add medicine</Button>}>
      {!items.length && <p className="text-sm text-ink-muted">No medicines prescribed.</p>}
      <datalist id="frequency-presets">
        {FREQUENCY_PRESETS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <ol className="space-y-3">
        {items.map((p, i) => (
          <li key={i} className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">Medicine {i + 1}</p>
              <Button size="sm" variant="ghost" aria-label={`Remove medicine ${i + 1}`} icon={<Trash2 aria-hidden="true" className="size-4" />} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                Remove
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TextField label="Medicine" value={p.drugName ?? ''} onChange={(e) => set(i, { drugName: e.target.value })} className="sm:col-span-2" />
              <TextField label="Strength" placeholder="500 mg" value={p.strength ?? ''} onChange={(e) => set(i, { strength: e.target.value })} />
              <TextField label="Form" placeholder="Tablet" value={p.form ?? ''} onChange={(e) => set(i, { form: e.target.value })} />
              <TextField label="Dose" placeholder="1 tablet" value={p.dose ?? ''} onChange={(e) => set(i, { dose: e.target.value })} />
              <TextField label="Route" value={p.route ?? ''} onChange={(e) => set(i, { route: e.target.value })} />
              <TextField label="Frequency" list="frequency-presets" value={p.frequency ?? ''} onChange={(e) => set(i, { frequency: e.target.value })} />
              <TextField label="Duration" placeholder="5 days" value={p.duration ?? ''} onChange={(e) => set(i, { duration: e.target.value })} />
              <TextField label="Instructions" placeholder="After food" value={p.instructions ?? ''} onChange={(e) => set(i, { instructions: e.target.value })} className="sm:col-span-2 lg:col-span-4" />
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-muted">No drug-interaction, allergy or dose checking is performed by this system. Check the patient’s allergies above.</p>
    </Card>
  )
}

function ReviewAndSignDialog({ draft, encounter, insertions, onClose, onSign, signing, error }: { draft: Draft; encounter: Encounter; insertions: NoteInsertion[]; onClose: () => void; onSign: () => void; signing: boolean; error: unknown }) {
  const [attest, setAttest] = useState(false)
  const issues = signIssues(draft)
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Review and sign"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back to editing
          </Button>
          <Button onClick={onSign} disabled={!attest || issues.length > 0} loading={signing}>
            Sign and complete
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {issues.length > 0 && (
          <Alert tone="error" title="Complete these before signing">
            <ul className="list-disc pl-5">
              {issues.map((i) => (
                <li key={i.path}>{i.message}</li>
              ))}
            </ul>
          </Alert>
        )}
        {error != null && <Alert tone="error">{errorMessage(error)}</Alert>}
        <p>
          <strong>{encounter.patient.fullName}</strong> ({encounter.patient.mrn}) · {fmtDate(encounter.visit.visitDate)} · token {encounter.visit.tokenNumber}
        </p>
        <dl className="space-y-2">
          {NOTE_SECTIONS.filter((s) => draft.note[s.key].trim()).map((s) => (
            <div key={s.key}>
              <dt className="font-medium">{s.label}</dt>
              <dd className="whitespace-pre-wrap text-ink-muted">{draft.note[s.key]}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="font-medium">Diagnosis</p>
          <ul className="list-disc pl-5">
            {draft.diagnoses.map((d, i) => (
              <li key={i}>
                {d.description} {d.code && `(${d.code})`} <span className="text-ink-muted">· {d.kind}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium">Prescription</p>
          {draft.prescription.length ? (
            <ol className="list-decimal pl-5">
              {draft.prescription.map((p, i) => (
                <li key={i}>
                  {[p.drugName, p.strength, p.form].filter(Boolean).join(' ')} — {p.dose}, {p.route}, {p.frequency}, {p.duration}
                  {p.instructions && `; ${p.instructions}`}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-ink-muted">None</p>
          )}
        </div>
        {insertions.length > 0 && (
          <div className="rounded-md border border-ai/30 bg-ai-soft p-3">
            <p className="font-medium">AI-assisted text in this note</p>
            <p className="text-xs text-ink-muted">The signed record keeps these references.</p>
            <AiProvenance insertions={insertions} />
          </div>
        )}
        <Alert tone="warning">After signing, this record cannot be edited. Corrections are added as amendments, and the original stays visible.</Alert>
        <CheckboxField label="I have reviewed this record, including any AI-assisted text, and it is accurate." checked={attest} onChange={(e) => setAttest(e.target.checked)} />
      </div>
    </Dialog>
  )
}

function ConsultationEditor({ initial, sidePanel }: { initial: Encounter; sidePanel?: SidePanel | undefined }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [draft, setDraft] = useState<Draft>({ note: initial.note, diagnoses: initial.diagnoses, prescription: initial.prescription })
  const [state, setState] = useState<SaveState>('saved')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [vitalsOpen, setVitalsOpen] = useState(false)
  const [insertions, setInsertions] = useState<NoteInsertion[]>(initial.aiInsertions)
  const [inserting, setInserting] = useState(false)
  const pendingInsertsRef = useRef(0)
  const draftRef = useRef(draft)
  const versionRef = useRef(initial.version)
  const dirtyRef = useRef(false)
  const chainRef = useRef<Promise<void>>(Promise.resolve())
  const stateRef = useRef<SaveState>('saved')
  const setSaveState = (s: SaveState) => {
    stateRef.current = s
    setState(s)
  }

  const update = (fn: (d: Draft) => Draft) => {
    if (stateRef.current === 'conflict') return
    const next = fn(draftRef.current)
    draftRef.current = next
    dirtyRef.current = true
    setDraft(next)
    setSaveState('dirty')
  }

  /** Saves serially; resolves once nothing is pending. */
  const flush = useCallback((): Promise<void> => {
    chainRef.current = chainRef.current.then(async () => {
      if (!dirtyRef.current || stateRef.current === 'conflict') return
      dirtyRef.current = false
      setSaveState('saving')
      try {
        const e = await api<Encounter>(`/encounters/${initial.id}/draft`, { method: 'PUT', body: { version: versionRef.current, ...draftRef.current } })
        versionRef.current = e.version
        setInsertions(e.aiInsertions)
        setSavedAt(new Date())
        setSaveState(dirtyRef.current ? 'dirty' : 'saved')
      } catch (err) {
        if (err instanceof ApiError && err.code === 'version_conflict') setSaveState('conflict')
        else {
          dirtyRef.current = true
          setSaveState('error')
        }
      }
    })
    return chainRef.current
  }, [initial.id])

  // Debounced autosave; retry after errors.
  useEffect(() => {
    if (state !== 'dirty' && state !== 'error') return
    const t = setTimeout(() => void flush(), state === 'error' ? 5000 : 1200)
    return () => clearTimeout(t)
  }, [draft, state, flush])

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current || stateRef.current === 'saving') e.preventDefault()
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [])

  const sign = useMutation({
    mutationFn: async () => {
      await flush()
      if (stateRef.current !== 'saved') throw new ApiError(409, 'not_saved', 'The latest changes could not be saved. Try again.')
      return api<Encounter>(`/encounters/${initial.id}/sign`, { method: 'POST', body: { version: versionRef.current, attestation: true } })
    },
    onSuccess: (e) => {
      qc.setQueryData(encounterKey(e.id), e)
      void qc.invalidateQueries({ queryKey: ['visits'] })
      void qc.invalidateQueries({ queryKey: ['patient', e.patient.id] })
      toast('success', 'Consultation signed and visit completed')
      setReviewing(false)
    },
  })

  /**
   * Saves pending edits, then asks the server to insert the reviewed AI text
   * (the server records which AI artifact it came from). The note is
   * read-only while this runs so no keystroke is lost.
   */
  const inserter: NoteInserter = {
    insert: async (section, text, subject) => {
      pendingInsertsRef.current += 1
      setInserting(true)
      try {
        await flush()
        // Runs on the same serial chain as autosave, so a save and an insertion never use the same version.
        const run = chainRef.current.then(async () => {
          if (stateRef.current === 'conflict') throw new ApiError(409, 'version_conflict', 'This consultation was changed in another window. Reload to continue.')
          if (dirtyRef.current || stateRef.current === 'error') {
            // Diagnoses or prescription changed meanwhile: save them first (note fields are read-only now).
            dirtyRef.current = false
            setSaveState('saving')
            try {
              const saved = await api<Encounter>(`/encounters/${initial.id}/draft`, { method: 'PUT', body: { version: versionRef.current, ...draftRef.current } })
              versionRef.current = saved.version
            } catch (err) {
              if (err instanceof ApiError && err.code === 'version_conflict') setSaveState('conflict')
              else {
                dirtyRef.current = true
                setSaveState('error')
              }
              throw err
            }
          }
          setSaveState('saving')
          try {
            const e = await api<Encounter>(`/encounters/${initial.id}/insertions`, { method: 'POST', body: { version: versionRef.current, section, text, subjectType: subject.type, subjectId: subject.id } })
            versionRef.current = e.version
            const next = { ...draftRef.current, note: e.note }
            draftRef.current = next
            setDraft(next)
            setInsertions(e.aiInsertions)
            setSavedAt(new Date())
            setSaveState(dirtyRef.current ? 'dirty' : 'saved')
          } catch (err) {
            if (err instanceof ApiError && err.code === 'version_conflict') setSaveState('conflict')
            else setSaveState(dirtyRef.current ? 'dirty' : 'saved')
            throw err
          }
        })
        chainRef.current = run.catch(() => undefined)
        await run
      } finally {
        pendingInsertsRef.current -= 1
        if (pendingInsertsRef.current === 0) setInserting(false)
      }
    },
    inserted: (type, id) => insertions.some((i) => i.subjectType === type && i.subjectId === id),
  }

  return (
    <>
      <PatientBanner patient={{ ...initial.patient }} />
      <h1 className="sr-only">Consultation for {initial.patient.fullName}</h1>
      {state === 'conflict' && (
        <Alert tone="error" title="This consultation was changed in another window" className="mb-4">
          Your latest edits were not saved. Copy anything you need, then{' '}
          <button type="button" className="font-semibold underline" onClick={() => void qc.invalidateQueries({ queryKey: encounterKey(initial.id) }).then(() => window.location.reload())}>
            reload the latest version
          </button>
          .
        </Alert>
      )}
      {/* Three panels: patient context | note | Mana and the assistant (stacked on smaller screens). */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_26rem] xl:grid-rows-[auto_1fr] 2xl:grid-cols-[17rem_minmax(0,1fr)_28rem] 2xl:grid-rows-none">
        <aside className="space-y-6 xl:col-start-2 xl:row-start-1 2xl:col-start-1" aria-label="Visit information">
          <Card title="This visit">
            <p className="text-sm">
              Token <strong>{initial.visit.tokenNumber}</strong> · {initial.visit.departmentName} · {fmtDate(initial.visit.visitDate)}
            </p>
            {initial.visit.reasonForVisit && <p className="mt-1 text-sm">Reason: “{initial.visit.reasonForVisit}”</p>}
            <div className="mt-3">
              <VitalsInline vitals={initial.vitals} />
            </div>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setVitalsOpen(true)}>
              Record vitals
            </Button>
          </Card>
          <Timeline patientId={initial.patient.id} />
        </aside>
        <div className="space-y-6 xl:col-start-1 xl:row-span-2 xl:row-start-1 2xl:col-start-2 2xl:row-span-1">
          <Card title="Consultation note" actions={inserting ? <Badge tone="ai">Inserting AI text…</Badge> : undefined}>
            <div className="space-y-4">
              {NOTE_SECTIONS.map((s) => (
                <div key={s.key}>
                  <TextAreaField
                    label={s.label}
                    hint={s.hint}
                    rows={s.rows}
                    value={draft.note[s.key]}
                    onChange={(e) => update((d) => ({ ...d, note: { ...d.note, [s.key]: e.target.value } }))}
                    readOnly={state === 'conflict' || inserting}
                  />
                  <AiProvenance insertions={insertions} section={s.key} />
                </div>
              ))}
            </div>
          </Card>
          <DiagnosesEditor items={draft.diagnoses} onChange={(diagnoses) => update((d) => ({ ...d, diagnoses }))} />
          <PrescriptionEditor items={draft.prescription} onChange={(prescription) => update((d) => ({ ...d, prescription }))} />
        </div>
        {sidePanel && <div className="min-w-0 space-y-6 xl:col-start-2 xl:row-start-2 2xl:col-start-3 2xl:row-start-1">{sidePanel(initial, inserter)}</div>}
      </div>
      <div className="sticky bottom-0 z-20 -mx-4 mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <SaveIndicator state={state} savedAt={savedAt} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => void flush()} disabled={state === 'saved' || state === 'conflict'}>
            Save now
          </Button>
          <Button onClick={() => setReviewing(true)} disabled={state === 'conflict'}>
            Review and sign
          </Button>
        </div>
      </div>
      {reviewing && <ReviewAndSignDialog draft={draft} encounter={initial} insertions={insertions} onClose={() => setReviewing(false)} onSign={() => sign.mutate()} signing={sign.isPending} error={sign.error} />}
      {vitalsOpen && (
        <RecordVitalsDialog
          visitId={initial.visit.id}
          patientName={initial.patient.fullName}
          onClose={() => {
            setVitalsOpen(false)
            void qc.invalidateQueries({ queryKey: encounterKey(initial.id) })
          }}
        />
      )}
    </>
  )
}

function AmendmentDialog({ encounterId, onClose }: { encounterId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [v, setV] = useState({ reason: '', content: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: (body: AmendmentRequest) => api<Encounter>(`/encounters/${encounterId}/amendments`, { method: 'POST', body }),
    onSuccess: (e) => {
      qc.setQueryData(encounterKey(encounterId), e)
      toast('success', 'Amendment added')
      onClose()
    },
  })
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add amendment"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              const r = AmendmentRequest.safeParse(v)
              if (!r.success) return setErrors(Object.fromEntries(r.error.issues.map((i) => [String(i.path[0]), i.message])))
              save.mutate(r.data)
            }}
          >
            Add amendment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {save.isError && <Alert tone="error">{errorMessage(save.error)}</Alert>}
        <p className="text-sm">The signed record stays as it is. Your amendment is added below it with your name and the time.</p>
        <TextField label="Reason" required value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} error={errors.reason} />
        <TextAreaField label="Amendment" required rows={5} value={v.content} onChange={(e) => setV({ ...v, content: e.target.value })} error={errors.content} />
      </div>
    </Dialog>
  )
}

export function EncounterReadView({ e }: { e: Encounter }) {
  const { data: me } = useMe()
  const base = usePortalBase()
  const [amending, setAmending] = useState(false)
  const signed = e.status === 'signed'
  return (
    <>
      <PatientBanner patient={e.patient} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Consultation · {fmtDate(e.visit.visitDate)}</h1>
          <p className="text-sm text-ink-muted">
            {e.doctor.fullName} · {e.visit.departmentName} · token {e.visit.tokenNumber}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {signed ? <Badge tone="ok">Signed {fmtDateTime(e.signedAt)}</Badge> : <Badge tone="warn">Draft — not signed</Badge>}
          {signed && (
            <Link to={`/print/encounters/${e.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium hover:bg-canvas">
              <Printer aria-hidden="true" className="size-4" />
              Print prescription
            </Link>
          )}
          {signed && me?.role === 'doctor' && (
            <Button variant="secondary" icon={<FilePlus2 aria-hidden="true" className="size-4" />} onClick={() => setAmending(true)}>
              Add amendment
            </Button>
          )}
        </div>
      </div>
      {!signed && <Alert tone="info" className="mb-4">This consultation is still a draft by {e.doctor.fullName}. Only they can edit and sign it.</Alert>}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Card title="Consultation note">
            <dl className="space-y-4 text-sm">
              {NOTE_SECTIONS.map((s) => (
                <div key={s.key}>
                  <dt className="font-medium">{s.label}</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap">{e.note[s.key] || <span className="text-ink-muted">—</span>}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Card title="Diagnosis">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {e.diagnoses.map((d, i) => (
                <li key={i}>
                  {d.description} {d.code && <span className="font-mono">({d.code})</span>} <span className="text-ink-muted">· {d.kind}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Prescription">
            {e.prescription.length ? (
              <ol className="list-decimal space-y-1 pl-5 text-sm">
                {e.prescription.map((p, i) => (
                  <li key={i}>
                    <strong>{[p.drugName, p.strength, p.form].filter(Boolean).join(' ')}</strong> — {p.dose}, {p.route}, {p.frequency}, {p.duration}
                    {p.instructions && `; ${p.instructions}`}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-ink-muted">No medicines prescribed.</p>
            )}
          </Card>
          {e.aiInsertions.length > 0 && (
            <Card title="AI-assisted text">
              <p className="text-xs text-ink-muted">Text in this note that the doctor inserted from AI or rule-based output, with its source.</p>
              <AiProvenance insertions={e.aiInsertions} />
            </Card>
          )}
          {e.amendments.length > 0 && (
            <Card title="Amendments">
              <ol className="space-y-3 text-sm">
                {e.amendments.map((a) => (
                  <li key={a.id} className="rounded-lg border border-notice/30 bg-notice-soft p-3">
                    <p className="font-medium">
                      {fmtDateTime(a.createdAt)} · {a.authorName}
                    </p>
                    <p className="text-ink-muted">Reason: {a.reason}</p>
                    <p className="mt-1 whitespace-pre-wrap">{a.content}</p>
                  </li>
                ))}
              </ol>
            </Card>
          )}
          {signed && e.contentHash && <p className="text-xs text-ink-muted">Integrity hash (SHA-256 of the signed content): <span className="font-mono break-all">{e.contentHash}</span></p>}
        </div>
        <aside className="space-y-6" aria-label="Visit information">
          <Card title="Vitals at this visit">
            <VitalsInline vitals={e.vitals} />
          </Card>
          <Timeline patientId={e.patient.id} />
          <Link to={`${base}/patients/${e.patient.id}`} className="block text-sm font-medium text-brand-strong underline underline-offset-2">
            Open patient record
          </Link>
        </aside>
      </div>
      {amending && <AmendmentDialog encounterId={e.id} onClose={() => setAmending(false)} />}
    </>
  )
}

export function ConsultationPage({ sidePanel }: { sidePanel?: SidePanel }) {
  const { encounterId } = useParams()
  const q = useEncounter(encounterId)
  const navigate = useNavigate()
  useDocumentTitle(q.data ? `Consultation · ${q.data.patient.fullName}` : 'Consultation')
  if (q.isPending) return <Spinner />
  if (q.isError)
    return (
      <Alert tone="error" title="Cannot open this consultation">
        {errorMessage(q.error)}{' '}
        <button type="button" className="underline" onClick={() => navigate(-1)}>
          Go back
        </button>
      </Alert>
    )
  return q.data.canEdit ? <ConsultationEditor key={q.data.id} initial={q.data} sidePanel={sidePanel} /> : <EncounterReadView e={q.data} />
}
