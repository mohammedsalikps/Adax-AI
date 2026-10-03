import {
  type Appointment,
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CHECK_IN_OUTCOME_LABELS,
  NOTIFICATION_FAILURE_LABELS,
  NOTIFICATION_KIND_LABELS,
  NOTIFICATION_STATUS_LABELS,
  type NotificationKind,
} from '@adaxai/contracts'
import { CalendarCheck, CalendarClock, Check, History, RotateCcw, UserX, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { errorMessage } from '../../lib/api.ts'
import { fmtClock, fmtInstantIn, fmtWhen, useAppointment, useCheckInAppointment, useRetryNotifications } from '../../lib/appointments.ts'
import { usePortalBase } from '../../lib/clinical.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { Alert, Badge, ErrorState, LoadingState } from '../ui/Feedback.tsx'
import { PatientAvatar } from '../ui/PatientAvatar.tsx'
import { useToast } from '../ui/Toast.tsx'
import { AppointmentStatusBadge, LinkedVisit } from './AppointmentBits.tsx'
import type { AppointmentDialogKind } from './AppointmentDialogs.tsx'

type Notify = (tone: 'success' | 'warning' | 'error', text: string) => void

/** A status as people say it ("did not attend", not no_show). */
const statusWord = (s: string) => (APPOINTMENT_STATUS_LABELS[s as keyof typeof APPOINTMENT_STATUS_LABELS] ?? s).toLowerCase()

/**
 * Check-in, the one action people take many times a day, so the schedule shows
 * it on the row. The outcome is reported through `notify` (a toast on a page;
 * inline inside a dialog, where a toast behind the modal would be neither seen
 * nor announced). Everything else is in the appointment's details.
 */
export function CheckInButton({ a, size = 'sm', notify, onBusy }: { a: Appointment; size?: 'sm' | 'md'; notify?: Notify; onBusy?: (busy: boolean) => void }) {
  const toast = useToast()
  const say: Notify = notify ?? toast
  const checkIn = useCheckInAppointment()
  const working = checkIn.isPending
  // A dialog that holds this button must not close while the request runs, or its outcome would be lost.
  useEffect(() => {
    onBusy?.(working)
    // If the button goes away mid-request (the appointment changed under it), the dialog must not stay locked.
    return () => onBusy?.(false)
  }, [working, onBusy])
  if (!a.actions.checkIn) return null
  return (
    <Button
      size={size}
      icon={<CalendarCheck aria-hidden="true" className="size-4" />}
      loading={checkIn.isPending}
      onClick={() =>
        checkIn.mutate(
          { id: a.id, version: a.version },
          {
            onSuccess: (r) => say('success', `${a.patient?.fullName ?? 'Patient'} checked in. Token ${r.visit.tokenNumber}. ${CHECK_IN_OUTCOME_LABELS[r.outcome]}`),
            onError: (e) => say('error', errorMessage(e)),
          },
        )
      }
    >
      Check in
    </Button>
  )
}

/** Every action the server says this user may take on the appointment now (shown in its details). */
export function AppointmentActions({ a, onDialog, size = 'sm', notify, onBusy }: { a: Appointment; onDialog: (kind: AppointmentDialogKind) => void; size?: 'sm' | 'md'; notify?: Notify; onBusy?: (busy: boolean) => void }) {
  if (!a.actions.checkIn && !a.actions.reschedule && !a.actions.cancel && !a.actions.noShow) return null
  return (
    <>
      <CheckInButton a={a} size={size} {...(notify && { notify })} {...(onBusy && { onBusy })} />
      {a.actions.reschedule && (
        <Button size={size} variant="secondary" icon={<CalendarClock aria-hidden="true" className="size-4" />} onClick={() => onDialog('reschedule')}>
          Reschedule…
        </Button>
      )}
      {a.actions.noShow && (
        <Button size={size} variant="ghost" icon={<UserX aria-hidden="true" className="size-4" />} onClick={() => onDialog('noshow')}>
          Did not attend…
        </Button>
      )}
      {a.actions.cancel && (
        <Button size={size} variant="ghost" icon={<XCircle aria-hidden="true" className="size-4" />} onClick={() => onDialog('cancel')}>
          Cancel…
        </Button>
      )}
    </>
  )
}

/** Everything about one appointment: where it is, what happened to it, and whether the patient was told. */
export function AppointmentDetailDialog({ id, onClose, onDialog }: { id: string; onClose: () => void; onDialog: (a: Appointment, kind: AppointmentDialogKind) => void }) {
  const q = useAppointment(id)
  const retry = useRetryNotifications(id)
  const [checkingIn, setCheckingIn] = useState(false)
  const base = usePortalBase()
  // Results of actions taken inside this dialog are said inside it.
  const [result, setResult] = useState<{ tone: 'success' | 'warning' | 'error'; text: string } | null>(null)
  const d = q.data
  // Event times are on the clinic's clock, like the appointment's own time (the browser's zone plays no part).
  const at = (iso: string) => (d ? fmtInstantIn(iso, d.timezone) : '')
  const retryable = d?.notifications.filter((n) => n.status !== 'delivered' && n.current) ?? []
  const noActions = d && !d.appointment.actions.checkIn && !d.appointment.actions.reschedule && !d.appointment.actions.cancel && !d.appointment.actions.noShow
  return (
    // While a request made from inside it runs (check in, try again), it stays open so that its outcome is shown.
    <Dialog open onClose={onClose} dismissible={!(checkingIn || retry.isPending)} title="Appointment" wide>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState title="The appointment could not be loaded" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
      {d && (
        <div className="space-y-5 text-sm" data-testid="appointment-detail">
          {result && <Alert tone={result.tone === 'error' ? 'error' : result.tone}>{result.text}</Alert>}
          <div className="flex gap-3">
            {d.appointment.patient && <PatientAvatar name={d.appointment.patient.fullName} size="lg" />}
            <div className="min-w-0 space-y-1.5">
              <p className="flex flex-wrap items-center gap-2 text-base font-semibold">
                {fmtWhen(d.appointment.localDate, d.appointment.localTime)}
                <span className="text-sm font-normal text-ink-muted">
                  to {fmtClock(d.appointment.endsLocalTime)} · {d.appointment.durationMinutes} min
                </span>
                <AppointmentStatusBadge status={d.appointment.status} />
                {d.appointment.overdue && <Badge tone="warn">Awaiting an outcome</Badge>}
              </p>
              {d.appointment.patient && (
                <p>
                  <Link to={`${base}/patients/${d.appointment.patient.id}`} className="font-medium text-brand-strong underline underline-offset-2">
                    {d.appointment.patient.fullName}
                  </Link>{' '}
                  <span className="text-ink-muted">{d.appointment.patient.mrn}</span>
                </p>
              )}
              <p>
                {d.appointment.departmentName} · {d.appointment.doctorName ?? 'Any doctor'}
              </p>
              {d.appointment.reason && <p>Reason: “{d.appointment.reason}”</p>}
              {d.appointment.statusReason && <p className="text-ink-muted">Reason for the last change: {d.appointment.statusReason}</p>}
              <LinkedVisit appointment={d.appointment} />
              {d.previous && <p className="text-ink-muted">Replaces the appointment on {fmtWhen(d.previous.localDate, d.previous.localTime)}.</p>}
              {d.next && <p className="text-ink-muted">Moved to {fmtWhen(d.next.localDate, d.next.localTime)}.</p>}
            </div>
          </div>

          <section aria-labelledby="appt-history">
            <h3 id="appt-history" className="mb-2 flex items-center gap-2 font-semibold">
              <History aria-hidden="true" className="size-4" /> History
            </h3>
            <ol className="space-y-2" aria-label="Status changes">
              {d.history.map((h, i) => (
                <li key={i} className="border-l-2 border-line pl-3">
                  <p className="font-medium">{h.from ? `${statusWord(h.from)} → ${statusWord(h.to)}` : `Created as ${statusWord(h.to)}`}</p>
                  <p className="text-xs text-ink-muted">
                    {at(h.at)} · {APPOINTMENT_SOURCE_LABELS[h.source] ?? h.source}
                    {h.actorName ? ` · ${h.actorName}` : ''}
                  </p>
                  {h.reason && <p className="text-xs">Reason: {h.reason}</p>}
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="appt-messages">
            <h3 id="appt-messages" className="mb-1 font-semibold">
              Messages to the patient
            </h3>
            <p className="mb-2 text-xs text-ink-muted">Patient portal only: no SMS, email or push message is sent.</p>
            {d.notifications.length === 0 && <p className="text-ink-muted">None.</p>}
            <ul className="space-y-2" aria-label="Messages">
              {d.notifications.map((n) => (
                <li key={n.id} className="rounded-lg border border-line p-2.5" data-testid={`notification-${n.kind}`}>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{NOTIFICATION_KIND_LABELS[n.kind as NotificationKind] ?? n.kind}</span>
                    {n.status !== 'delivered' && !n.current ? <Badge tone="neutral">Not needed any more</Badge> : <Badge tone={n.status === 'delivered' ? 'ok' : n.status === 'queued' ? 'neutral' : 'warn'}>{NOTIFICATION_STATUS_LABELS[n.status]}</Badge>}
                    {n.readAt && <Badge tone="ok">Seen by the patient</Badge>}
                  </p>
                  <p className="text-xs text-ink-muted">
                    {n.attempts} attempt{n.attempts === 1 ? '' : 's'}
                    {n.lastAttemptAt ? `, last ${at(n.lastAttemptAt)}` : ''}
                    {n.failureCode ? ` · ${NOTIFICATION_FAILURE_LABELS[n.failureCode] ?? n.failureCode}` : ''}
                    {n.status !== 'delivered' && !n.current ? ' · The appointment has changed since, so this message is not retried.' : ''}
                  </p>
                </li>
              ))}
            </ul>
            {retryable.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<RotateCcw aria-hidden="true" className="size-4" />}
                  loading={retry.isPending}
                  onClick={() =>
                    retry.mutate(undefined, {
                      onSuccess: (r) => {
                        const delivered = r.notifications.filter((n) => n.status === 'delivered').length
                        if (!r.retried) setResult({ tone: 'warning', text: 'Nothing was tried again: another request is already trying, or every message is delivered.' })
                        else setResult({ tone: delivered === r.notifications.length ? 'success' : 'warning', text: `Tried again: ${delivered} of ${r.notifications.length} messages are available in the patient portal.` })
                      },
                      onError: (e) => setResult({ tone: 'error', text: errorMessage(e) }),
                    })
                  }
                >
                  Try again
                </Button>
                <span className="text-xs text-ink-muted">A message can be delivered once the patient has an active portal account.</span>
              </div>
            )}
          </section>

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
            <AppointmentActions a={d.appointment} size="md" notify={(tone, text) => setResult({ tone, text })} onBusy={setCheckingIn} onDialog={(k) => onDialog(d.appointment, k)} />
            {noActions && (
              <p className="flex items-center gap-1 text-ink-muted">
                <Check aria-hidden="true" className="size-4" />
                {d.appointment.status === 'booked' ? 'No actions are available to your role.' : d.appointment.status === 'checked_in' ? 'Checked in: the visit in the queue decides how this ends.' : 'This appointment is closed.'}
              </p>
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
