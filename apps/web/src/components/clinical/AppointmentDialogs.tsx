import {
  type Appointment,
  type AppointmentOptions,
  CancelAppointmentRequest,
  CreateAppointmentRequest,
  NoShowAppointmentRequest,
  RescheduleAppointmentRequest,
} from '@adaxai/contracts'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { errorMessage } from '../../lib/api.ts'
import { appointmentErrorMessage, fmtWhen, patientNote, useAppointmentOptions, useBookAppointment, useCancelAppointment, useNoShowAppointment, useRescheduleAppointment } from '../../lib/appointments.ts'
import { useMe } from '../../lib/auth.tsx'
import { usePatientLookup } from '../../lib/clinical.ts'
import { useForm } from '../../lib/useForm.ts'
import { useDepartments } from '../../pages/admin/AdminUsersPage.tsx'
import { Button } from '../ui/Button.tsx'
import { ConfirmationDialog } from '../ui/ConfirmationDialog.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, LoadingState } from '../ui/Feedback.tsx'
import { SelectField, TextAreaField, TextField } from '../ui/Form.tsx'
import { useToast } from '../ui/Toast.tsx'
import { PatientAvatar } from '../ui/PatientAvatar.tsx'
import { AppointmentDetailDialog } from './AppointmentDetail.tsx'
import { useDoctors } from './CheckInDialog.tsx'

export type AppointmentDialogKind = 'reschedule' | 'cancel' | 'noshow'
/** Which dialog is open over a schedule: booking, one appointment's details, or an action on an appointment. */
export type AppointmentDialogState = { kind: 'book' } | { kind: 'detail'; id: string } | { kind: AppointmentDialogKind; a: Appointment } | null

type PickedPatient = { id: string; fullName: string; mrn: string }

/** Shown with a failed save: field problems sit on their fields, anything else (a taken slot, a stale screen) is said once. */
function SaveError({ error, hasFieldErrors }: { error: unknown; hasFieldErrors: boolean }) {
  if (!error || hasFieldErrors) return null
  return <Alert tone="error">{appointmentErrorMessage(error)}</Alert>
}

interface SlotFields {
  departmentId: string
  doctorId: string | null | undefined
  date: string
  time: string
  durationMinutes: number | undefined
}

/** Department, clinician, day, time and length: shared by booking and rescheduling. */
function SlotInputs({ v, set, errors, options }: { v: SlotFields; set: (k: keyof SlotFields, value: never) => void; errors: Record<string, string>; options: AppointmentOptions }) {
  const depts = useDepartments()
  const doctors = useDoctors()
  const all = doctors.data ?? []
  const inDept = all.filter((d) => !v.departmentId || d.departmentId === v.departmentId)
  const setAny = set as (k: string, value: unknown) => void
  // A clinician who is not in the chosen department is dropped, so the form never holds a doctor the select does not show.
  const changeDepartment = (id: string) => {
    setAny('departmentId', id)
    const current = all.find((d) => d.id === v.doctorId)
    if (current && current.departmentId !== id) setAny('doctorId', null)
  }
  return (
    <>
      <SelectField label="Department" required value={v.departmentId} onChange={(e) => changeDepartment(e.target.value)} error={errors.departmentId}>
        <option value="">Choose…</option>
        {depts.data?.filter((d) => d.isActive).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </SelectField>
      <SelectField label="Doctor" hint="Optional. A doctor holds the slot: nobody else can book them at the same time." value={v.doctorId ?? ''} onChange={(e) => setAny('doctorId', e.target.value || null)} error={errors.doctorId}>
        <option value="">Any doctor in the department</option>
        {inDept.map((d) => (
          <option key={d.id} value={d.id}>
            {d.fullName}
          </option>
        ))}
      </SelectField>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <TextField label="Date" type="date" required min={options.today} max={options.maxDate} value={v.date} onChange={(e) => setAny('date', e.target.value)} error={errors.date} />
        <TextField label="Time" type="time" required step={options.slotMinutes * 60} value={v.time} onChange={(e) => setAny('time', e.target.value)} error={errors.time} />
      </div>
      <SelectField label="Length" value={String(v.durationMinutes ?? options.defaultDuration)} onChange={(e) => setAny('durationMinutes', Number(e.target.value))} error={errors.durationMinutes}>
        {options.durations.map((d) => (
          <option key={d} value={d}>
            {d} minutes
          </option>
        ))}
      </SelectField>
      <p className="text-xs text-ink-muted">Times are on the clinic’s clock ({options.timezone}).</p>
    </>
  )
}

/** Choose the patient to book for. Nothing is searched until two characters are typed, and only the current term's results are shown. */
function PatientPicker({ chosen, onChoose, error }: { chosen: PickedPatient | null; onChoose: (p: PickedPatient | null) => void; error?: string | undefined }) {
  const [search, setSearch] = useState('')
  const lookup = usePatientLookup(search)
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">
        Patient{' '}
        <span aria-hidden="true" className="text-down">
          *
        </span>
      </legend>
      {chosen ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-canvas p-2.5" data-testid="chosen-patient">
          <PatientAvatar name={chosen.fullName} size="sm" />
          <p className="text-sm">
            <strong>{chosen.fullName}</strong> ({chosen.mrn})
          </p>
          <Button size="sm" variant="ghost" onClick={() => onChoose(null)}>
            Change
          </Button>
        </div>
      ) : (
        <>
          <TextField label="Find the patient" hint="Name, phone number or MRN (at least 2 characters)." value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
          {lookup.status === 'searching' && (
            <p role="status" className="text-sm text-ink-muted">
              Searching…
            </p>
          )}
          {lookup.status === 'error' && (
            <Alert tone="error">
              <p>{errorMessage(lookup.error)}</p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={lookup.retry}>
                Try again
              </Button>
            </Alert>
          )}
          {lookup.status === 'done' && (
            <p role="status" className="sr-only">
              {lookup.patients.length > 6 ? `${lookup.patients.length} patients found; the first 6 are listed. Type more to narrow them.` : `${lookup.patients.length} patients found.`}
            </p>
          )}
          {lookup.status === 'done' && lookup.patients.length > 6 && <p className="text-xs text-ink-muted">Showing the first 6 matches. Type more of the name, the MRN or the phone number to narrow them.</p>}
          {lookup.status === 'done' && lookup.patients.length > 0 && (
            <ul className="space-y-1" aria-label="Matching patients">
              {lookup.patients.slice(0, 6).map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex min-h-control w-full items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-left text-sm hover:bg-canvas"
                    onClick={() => onChoose({ id: p.id, fullName: p.fullName, mrn: p.mrn })}
                  >
                    <span className="font-medium">{p.fullName}</span>
                    <span className="text-xs text-ink-muted">{p.mrn}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {lookup.status === 'done' && !lookup.patients.length && <p className="text-sm text-ink-muted">No patient matches. Register them first.</p>}
        </>
      )}
      {error && <p className="text-xs font-medium text-down">Choose the patient</p>}
    </fieldset>
  )
}

/** Opens while the schedule options load or fail, so the form (and its request key) is built only once there is something to build it from. */
function OptionsGate({ title, onClose, options, children }: { title: string; onClose: () => void; options: ReturnType<typeof useAppointmentOptions>; children: (o: AppointmentOptions) => ReactNode }) {
  if (options.data) return <>{children(options.data)}</>
  return (
    <Dialog open onClose={onClose} title={title}>
      {options.isError ? (
        <div className="space-y-3">
          <Alert tone="error">{errorMessage(options.error)}</Alert>
          <Button size="sm" variant="secondary" loading={options.isFetching} onClick={() => void options.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <LoadingState />
      )}
    </Dialog>
  )
}

/** Book a slot for a patient (chosen on the record, or searched here). */
export function BookAppointmentDialog({ patient, onClose }: { patient?: PickedPatient; onClose: () => void }) {
  const options = useAppointmentOptions()
  const { data: me } = useMe()
  return (
    <OptionsGate title="Book an appointment" onClose={onClose} options={options}>
      {(o) => <BookForm options={o} patient={patient} departmentId={me?.departmentId ?? ''} onClose={onClose} />}
    </OptionsGate>
  )
}

function BookForm({ options, patient, departmentId, onClose }: { options: AppointmentOptions; patient?: PickedPatient | undefined; departmentId: string; onClose: () => void }) {
  const toast = useToast()
  const book = useBookAppointment()
  // One key per dialog: pressing "Book" again after a lost answer returns the same appointment, never a second one.
  const form = useForm(CreateAppointmentRequest, { patientId: patient?.id ?? '', departmentId, doctorId: null, date: options.today, time: '', durationMinutes: options.defaultDuration, reason: '', idempotencyKey: crypto.randomUUID() })
  const [chosen, setChosen] = useState<PickedPatient | null>(patient ?? null)
  const v = form.values
  // Closing while the request is in flight would lose its answer (and the patient-told warning).
  const close = () => {
    if (!book.isPending) onClose()
  }
  return (
    <Dialog
      open
      onClose={close}
      dismissible={!book.isPending}
      title="Book an appointment"
      footer={
        <>
          <Button variant="secondary" disabled={book.isPending} onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="book-form" loading={book.isPending}>
            Book appointment
          </Button>
        </>
      }
    >
      <form
        id="book-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const body = form.validate()
          if (!body) return
          book.mutate(body, {
            onSuccess: (a) => {
              const note = patientNote(a)
              toast(note.tone, `Booked ${fmtWhen(a.localDate, a.localTime)}. ${note.text}`)
              onClose()
            },
            onError: (err) => form.applyServerErrors(err),
          })
        }}
      >
        <SaveError error={book.error} hasFieldErrors={Object.keys(form.errors).length > 0} />
        {patient ? (
          <p className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-2.5 text-sm">
            <PatientAvatar name={patient.fullName} size="sm" />
            <span>
              Patient: <strong>{patient.fullName}</strong> ({patient.mrn})
            </span>
          </p>
        ) : (
          <PatientPicker
            chosen={chosen}
            error={form.errors.patientId}
            onChoose={(p) => {
              setChosen(p)
              form.set('patientId', p?.id ?? '')
            }}
          />
        )}
        <SlotInputs v={v as SlotFields} set={form.set as never} errors={form.errors} options={options} />
        <TextAreaField label="Reason for the visit" rows={2} hint="In the patient’s words, e.g. “fever for 3 days”. Seen by clinic staff only: not sent to the patient." value={v.reason ?? ''} onChange={(e) => form.set('reason', e.target.value)} error={form.errors.reason} />
      </form>
    </Dialog>
  )
}

/** Move an appointment: a new time is booked and this one is closed as rescheduled. Nothing moves until it is confirmed. */
export function RescheduleDialog({ a, onClose }: { a: Appointment; onClose: () => void }) {
  const options = useAppointmentOptions()
  return (
    <OptionsGate title="Reschedule" onClose={onClose} options={options}>
      {(o) => <RescheduleForm a={a} options={o} onClose={onClose} />}
    </OptionsGate>
  )
}

function RescheduleForm({ a, options, onClose }: { a: Appointment; options: AppointmentOptions; onClose: () => void }) {
  const toast = useToast()
  const move = useRescheduleAppointment(a.id)
  const form = useForm(RescheduleAppointmentRequest, { version: a.version, date: a.localDate, time: a.localTime, durationMinutes: a.durationMinutes, departmentId: a.departmentId, doctorId: a.doctorId, reason: '', idempotencyKey: crypto.randomUUID() })
  const v = form.values
  const close = () => {
    if (!move.isPending) onClose()
  }
  return (
    <Dialog
      open
      onClose={close}
      dismissible={!move.isPending}
      title={`Reschedule ${a.patient?.fullName ?? 'appointment'}`}
      footer={
        <>
          <Button variant="secondary" disabled={move.isPending} onClick={close}>
            Keep the current time
          </Button>
          <Button type="submit" form="reschedule-form" loading={move.isPending}>
            Move appointment
          </Button>
        </>
      }
    >
      <form
        id="reschedule-form"
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          const body = form.validate()
          if (!body) return
          move.mutate(body, {
            onSuccess: (n) => {
              const note = patientNote(n)
              toast(note.tone, `Moved to ${fmtWhen(n.localDate, n.localTime)}. ${note.text}`)
              onClose()
            },
            onError: (err) => form.applyServerErrors(err),
          })
        }}
      >
        <SaveError error={move.error} hasFieldErrors={Object.keys(form.errors).length > 0} />
        <p className="text-sm">
          Now: <strong>{fmtWhen(a.localDate, a.localTime)}</strong> ({a.durationMinutes} min) · {a.departmentName} · {a.doctorName ?? 'any doctor'}. A message about the new time is made available in the patient portal if the patient has portal access. It is not sent by SMS or email.
        </p>
        <SlotInputs v={v as SlotFields} set={form.set as never} errors={form.errors} options={options} />
        <TextField label="Reason for moving it" required value={v.reason} onChange={(e) => form.set('reason', e.target.value)} error={form.errors.reason} hint="Kept with the appointment’s history, not in messages." />
      </form>
    </Dialog>
  )
}

export function CancelAppointmentDialog({ a, onClose }: { a: Appointment; onClose: () => void }) {
  const toast = useToast()
  const cancel = useCancelAppointment(a.id)
  const form = useForm(CancelAppointmentRequest, { version: a.version, reason: '' })
  return (
    <ConfirmationDialog
      title={`Cancel ${a.patient?.fullName ?? 'appointment'}`}
      keepLabel="Keep the appointment"
      confirmLabel="Cancel appointment"
      loading={cancel.isPending}
      error={Object.keys(form.errors).length ? undefined : cancel.error ? appointmentErrorMessage(cancel.error) : undefined}
      onClose={onClose}
      onConfirm={() => {
        const body = form.validate()
        if (!body) return
        cancel.mutate(body, {
          onSuccess: (done) => {
            const note = patientNote(done)
            toast(note.tone, `Appointment cancelled. ${note.text}`)
            onClose()
          },
          onError: (err) => form.applyServerErrors(err),
        })
      }}
      reason={{ label: 'Reason', required: true, value: form.values.reason, onChange: (r) => form.set('reason', r), error: form.errors.reason, hint: 'Kept with the appointment’s history, not in messages.' }}
    >
      <p>
        {fmtWhen(a.localDate, a.localTime)} · {a.departmentName}. The slot is released and stays on record as cancelled. A message is made available in the patient portal if the patient has portal access. It is not sent by SMS or email, so tell the patient another way if they have no access.
      </p>
    </ConfirmationDialog>
  )
}

export function NoShowDialog({ a, onClose }: { a: Appointment; onClose: () => void }) {
  const toast = useToast()
  const noShow = useNoShowAppointment(a.id)
  const form = useForm(NoShowAppointmentRequest, { version: a.version, reason: '' })
  return (
    <ConfirmationDialog
      title={`${a.patient?.fullName ?? 'Appointment'} did not attend`}
      keepLabel="Not yet"
      confirmLabel="Mark as did not attend"
      loading={noShow.isPending}
      error={Object.keys(form.errors).length ? undefined : noShow.error ? appointmentErrorMessage(noShow.error) : undefined}
      onClose={onClose}
      onConfirm={() => {
        const body = form.validate()
        if (!body) return
        noShow.mutate(body, {
          onSuccess: () => {
            toast('success', 'Marked as did not attend')
            onClose()
          },
          onError: (err) => form.applyServerErrors(err),
        })
      }}
      reason={{ label: 'Note (optional)', value: form.values.reason ?? '', onChange: (r) => form.set('reason', r), error: form.errors.reason }}
    >
      <p>The appointment at {fmtWhen(a.localDate, a.localTime)} is closed as “did not attend”. This cannot be undone; book a new appointment if they come later.</p>
    </ConfirmationDialog>
  )
}

/**
 * Renders whichever appointment dialog is open. Pages keep only the state
 * (`useState<AppointmentDialogState>`), so booking, details, rescheduling,
 * cancelling and did-not-attend behave the same wherever appointments appear.
 */
export function AppointmentDialogHost({ dialog, onChange, patient }: { dialog: AppointmentDialogState; onChange: (d: AppointmentDialogState) => void; patient?: PickedPatient }) {
  const close = () => onChange(null)
  // One dialog can replace another (Details, then Reschedule). A <dialog> that is removed restores nothing, so the host remembers
  // what had the focus when the first one opened (before any dialog takes it) and gives it back when the last one closes.
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  useLayoutEffect(() => {
    if (dialog && !wasOpen.current) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [dialog])
  useEffect(() => {
    if (!dialog && wasOpen.current && opener.current?.isConnected) opener.current.focus()
    wasOpen.current = !!dialog
  }, [dialog])
  if (!dialog) return null
  switch (dialog.kind) {
    case 'book':
      return <BookAppointmentDialog {...(patient && { patient })} onClose={close} />
    case 'detail':
      return <AppointmentDetailDialog id={dialog.id} onClose={close} onDialog={(a, kind) => onChange({ kind, a })} />
    case 'reschedule':
      return <RescheduleDialog a={dialog.a} onClose={close} />
    case 'cancel':
      return <CancelAppointmentDialog a={dialog.a} onClose={close} />
    case 'noshow':
      return <NoShowDialog a={dialog.a} onClose={close} />
  }
}
