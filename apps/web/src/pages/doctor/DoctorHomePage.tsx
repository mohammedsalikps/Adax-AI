import { OPEN_VISIT_STATUSES, type Appointment, type Visit } from '@adaxai/contracts'
import { CalendarCheck, CalendarClock, CalendarPlus, CheckCircle2, ClipboardList, FileSignature, type LucideIcon, Stethoscope, UserPlus, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { AppointmentDialogHost, type AppointmentDialogState } from '../../components/clinical/AppointmentDialogs.tsx'
import { AppointmentStatusBadge } from '../../components/clinical/AppointmentBits.tsx'
import { CheckInButton } from '../../components/clinical/AppointmentDetail.tsx'
import { ageSex, AllergySummary } from '../../components/clinical/PatientBanner.tsx'
import { VisitStatusBadge } from '../../components/clinical/VisitStatusBadge.tsx'
import { Badge, EmptyState, ErrorState, LoadingState } from '../../components/ui/Feedback.tsx'
import { PatientAvatar } from '../../components/ui/PatientAvatar.tsx'
import { clockHHMM, fmtClock, useAppointmentOptions, useAppointments } from '../../lib/appointments.ts'
import { useMe } from '../../lib/auth.tsx'
import { useVisits } from '../../lib/clinical.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'

/** How many of today's patients the schedule lists before sending the doctor to the full list. */
const SCHEDULE_ROWS = 8
/** However many patients are waiting for the doctor, the next few others (the earliest appointments and the earliest to arrive) stay in view. */
const MIN_NEXT = 3

const TINTS = {
  brand: { card: 'bg-brand-soft/60 border-brand/15', tile: 'bg-brand/10 text-brand' },
  warn: { card: 'bg-pending-soft/60 border-pending/15', tile: 'bg-pending/10 text-pending' },
  ok: { card: 'bg-ok-soft/60 border-ok/15', tile: 'bg-ok/10 text-ok' },
  done: { card: 'bg-surface border-line', tile: 'bg-canvas text-ink-muted' },
} as const

function Stat({ label, value, hint, icon: Icon, tone, loading }: { label: string; value: number | undefined; hint: string; icon: LucideIcon; tone: keyof typeof TINTS; loading: boolean }) {
  const t = TINTS[tone]
  return (
    <li className={`flex items-center gap-4 rounded-2xl border p-4 ${t.card}`} aria-busy={loading || undefined}>
      <span aria-hidden="true" className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${t.tile}`}>
        <Icon className="size-6" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-muted">{label}</p>
        <p className="text-stat font-semibold tabular-nums">
          {loading || value === undefined ? (
            <>
              <span aria-hidden="true">–</span>
              <span className="sr-only">Not loaded yet</span>
            </>
          ) : (
            value
          )}
        </p>
        <p className="text-xs text-ink-muted">{hint}</p>
      </div>
    </li>
  )
}

/** "Dr. Meera Iyer (synthetic)" becomes "Meera". */
const firstName = (full: string | undefined) =>
  (full ?? '')
    .replace(/\([^)]*\)/g, '')
    .replace(/^dr\.?\s+/i, '')
    .trim()
    .split(/\s+/)[0] ?? ''

const greeting = (d = new Date()) => (d.getHours() < 12 ? 'Good morning' : d.getHours() < 17 ? 'Good afternoon' : 'Good evening')

interface Item {
  key: string
  time: string
  /** For sorting (HH:MM on the facility's clock). */
  sort: string
  visit?: Visit
  appointment?: Appointment
}

function ScheduleRow({ item, action }: { item: Item; action: ReactNode }) {
  const v = item.visit
  const a = item.appointment
  const patient = v?.patient ?? a?.patient
  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_auto]" data-testid={v ? `ready-${v.tokenNumber}` : `appointment-${a?.id}`}>
      <p className="text-sm font-semibold tabular-nums">{item.time}</p>
      <div className="flex min-w-0 items-center gap-3">
        {patient ? (
          <>
            <PatientAvatar name={patient.fullName} size="md" />
            <div className="min-w-0">
              <Link to={`/doctor/patients/${patient.id}`} className="block font-semibold break-words text-brand-strong hover:underline">
                {patient.fullName}
              </Link>
              <p className="text-xs break-words text-ink-muted">
                {v ? `${ageSex(v.patient)} · ` : ''}
                {patient.mrn}
              </p>
              <p className="text-xs break-words">{v?.chiefComplaint ?? a?.reason ?? 'No reason recorded'}</p>
              {v && <AllergySummary noKnownAllergies={v.patient.noKnownAllergies} activeAllergies={v.patient.activeAllergies} />}
            </div>
          </>
        ) : (
          <span className="text-sm text-ink-muted">Patient not shown</span>
        )}
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-1.5 sm:col-start-auto">
        {v ? <VisitStatusBadge status={v.status} /> : a ? <AppointmentStatusBadge status={a.status} /> : null}
        {v?.priority === 'urgent' && <Badge tone="down">Urgent</Badge>}
      </div>
      <div className="col-start-2 sm:col-start-auto sm:justify-self-end">{action}</div>
    </li>
  )
}

/**
 * The doctor's landing page: a greeting, how today stands (counts from the
 * queue and the schedule, nothing invented), today's patients in time order
 * (appointments and walk-ins together, each with its real state and the one
 * action that applies), and shortcuts to places that exist.
 */
export function DoctorHomePage({ consultationAction, notice }: { consultationAction?: (v: Visit) => ReactNode; notice?: ReactNode }) {
  const { data: me } = useMe()
  useDocumentTitle('Home')
  const [dialog, setDialog] = useState<AppointmentDialogState>(null)
  const queue = useVisits({ mine: true })
  const today = useAppointments({ scope: 'today', mine: 'true' })
  // Walk-ins and appointments are on one clock: the facility's, not the browser's.
  const timezone = useAppointmentOptions().data?.timezone

  const visits = queue.data?.visits ?? []
  const appointments = (today.data?.items ?? []).filter((a) => a.status !== 'rescheduled')
  const count = (...s: Visit['status'][]) => visits.filter((v) => s.includes(v.status)).length
  const upcoming = appointments.filter((a) => a.status === 'booked' && !a.overdue).length

  // Everyone today in time order: each visit (with its appointment time if it came from one), then appointments with no visit yet.
  const withVisit = new Set(visits.flatMap((v) => (v.appointment ? [v.appointment.id] : [])))
  // Those already seen (or cancelled, or who did not come) are in the counts above and under "Today's patients"; this list is who is still to be seen.
  const items: Item[] = [
    ...visits.filter((v) => OPEN_VISIT_STATUSES.includes(v.status)).map((v): Item => ({ key: v.id, time: fmtClock(v.appointment?.localTime ?? clockHHMM(v.checkedInAt, timezone)), sort: v.appointment?.localTime ?? clockHHMM(v.checkedInAt, timezone), visit: v })),
    ...appointments.filter((a) => a.status === 'booked' && !withVisit.has(a.id) && a.visit === null).map((a): Item => ({ key: a.id, time: fmtClock(a.localTime), sort: a.localTime, appointment: a })),
  ].sort((x, y) => x.sort.localeCompare(y.sort))
  // Patients ready for the doctor or with the doctor are always listed (however many); the rest fill the remaining rows, earliest first, and
  // the next few stay in view even when many are waiting (a doctor with a full waiting room still sees who is due next).
  const needsDoctor = (i: Item) => i.visit?.status === 'ready' || i.visit?.status === 'in_consultation'
  const others = items.filter((i) => !needsDoctor(i))
  const rows = [...items.filter(needsDoctor), ...others.slice(0, Math.max(MIN_NEXT, SCHEDULE_ROWS - (items.length - others.length)))].sort((x, y) => x.sort.localeCompare(y.sort))
  const hidden = items.length - rows.length
  const loading = queue.isPending || today.isPending

  const actionFor = (item: Item): ReactNode => {
    const v = item.visit
    if (v && OPEN_VISIT_STATUSES.includes(v.status)) {
      if (v.status === 'ready' || v.status === 'in_consultation') return consultationAction?.(v) ?? null
      return <span className="text-xs text-ink-muted">With the nurse</span>
    }
    if (v?.encounterId) return <Link to={`/doctor/encounters/${v.encounterId}`} className="text-sm font-medium whitespace-nowrap text-brand-strong hover:underline">Open record</Link>
    if (item.appointment?.status === 'booked') return item.appointment.actions.checkIn ? <CheckInButton a={item.appointment} /> : <span className="text-xs text-ink-muted">Not arrived yet</span>
    return null
  }

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {greeting()}, Dr. {firstName(me?.fullName)}
          </h1>
          <p className="text-sm text-ink-muted">Here is your overview for today.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          {queue.data && <span>{new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${queue.data.date}T00:00:00`))}</span>}
          {me?.departmentName && <Badge tone="brand">{me.departmentName}</Badge>}
        </div>
      </div>
      {notice}

      <ul aria-label="Today at a glance" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="In the queue" value={queue.data ? count('waiting', 'in_triage', 'ready') : undefined} loading={queue.isPending} icon={ClipboardList} tone="brand" hint="Patients waiting" />
        <Stat label="With a doctor" value={queue.data ? count('in_consultation') : undefined} loading={queue.isPending} icon={Stethoscope} tone="ok" hint="In consultation" />
        <Stat label="Completed today" value={queue.data ? count('completed') : undefined} loading={queue.isPending} icon={CheckCircle2} tone="done" hint="Signed consultations" />
        <Stat label="Appointments to come" value={today.data ? upcoming : undefined} loading={today.isPending} icon={CalendarClock} tone="warn" hint="Booked, not yet arrived" />
      </ul>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="schedule-heading" className="min-w-0 rounded-2xl border border-line bg-surface shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
            <h2 id="schedule-heading" className="text-base font-semibold">
              Today’s schedule
            </h2>
            <Link to="/doctor/queue" className="text-sm font-medium text-brand-strong hover:underline">
              View all
            </Link>
          </div>
          {loading && (
            <div className="p-4">
              <LoadingState label="Loading today’s patients…" />
            </div>
          )}
          {queue.isError && !queue.data && (
            <div className="p-4">
              <ErrorState title="The queue could not be loaded" error={queue.error} onRetry={() => void queue.refetch()} retrying={queue.isFetching} />
            </div>
          )}
          {today.isError && !today.data && (
            <div className="p-4">
              <ErrorState title="Today’s schedule could not be loaded" error={today.error} onRetry={() => void today.refetch()} retrying={today.isFetching} />
            </div>
          )}
          {(queue.isError && queue.data) || (today.isError && today.data) ? <p className="px-5 pt-3 text-sm text-pending">The latest update failed, so this may be out of date.</p> : null}
          {!loading && queue.data && today.data && !items.length && (
            <div className="p-4">
              <EmptyState icon={CalendarCheck} title="No patients today">
                Patients appear here when they are booked or checked in.
              </EmptyState>
            </div>
          )}
          {rows.length > 0 && (
            <ul className="divide-y divide-line" aria-label="Today’s patients">
              {rows.map((item) => (
                <ScheduleRow key={item.key} item={item} action={actionFor(item)} />
              ))}
            </ul>
          )}
          {hidden > 0 && (
            <p className="border-t border-line px-5 py-3 text-sm text-ink-muted">
              {hidden} more today.{' '}
              <Link to="/doctor/queue" className="font-medium text-brand-strong underline">
                See all of today’s patients
              </Link>
            </p>
          )}
        </section>

        <section aria-labelledby="quick-heading" className="min-w-0 rounded-2xl border border-line bg-surface p-5 shadow-card">
          <h2 id="quick-heading" className="mb-3 text-base font-semibold">
            Quick actions
          </h2>
          <ul className="grid grid-cols-2 gap-3">
            <li>
              <button type="button" onClick={() => setDialog({ kind: 'book' })} className="flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-xl border border-line p-3 text-center text-sm font-medium hover:bg-canvas">
                <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  <CalendarPlus className="size-5" />
                </span>
                New appointment
              </button>
            </li>
            {(
              [
                ['/doctor/register', 'Register patient', UserPlus],
                ['/doctor/patients', 'Find a patient', Users],
                ['/doctor/consultations', 'My consultations', FileSignature],
              ] as const
            ).map(([to, label, Icon]) => (
              <li key={to}>
                <Link to={to} className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border border-line p-3 text-center text-sm font-medium hover:bg-canvas">
                  <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
                    <Icon className="size-5" />
                  </span>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <AppointmentDialogHost dialog={dialog} onChange={setDialog} />
    </>
  )
}
