import type { Visit } from '@adaxai/contracts'
import { ArrowRight, BrainCircuit, CalendarCheck, CalendarClock, CalendarPlus, CheckCircle2, ClipboardList, FileSignature, Stethoscope, Users } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link } from 'react-router'
import { AppointmentDialogHost, type AppointmentDialogState } from '../../components/clinical/AppointmentDialogs.tsx'
import { AppointmentTable } from '../../components/clinical/AppointmentTable.tsx'
import { ageSex, AllergySummary } from '../../components/clinical/PatientBanner.tsx'
import { VisitStatusBadge } from '../../components/clinical/VisitStatusBadge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Badge, EmptyState, ErrorState, LoadingState } from '../../components/ui/Feedback.tsx'
import { Card, PageHeader, StatCard } from '../../components/ui/Layout.tsx'
import { PatientAvatar } from '../../components/ui/PatientAvatar.tsx'
import { useAppointments } from '../../lib/appointments.ts'
import { useMe } from '../../lib/auth.tsx'
import { useVisits } from '../../lib/clinical.ts'
import { fmtDate } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'

/** How many of today's appointments the card lists before sending the doctor to the full schedule. */
const SCHEDULE_ROWS = 8

const QUICK: { to: string; label: string; icon: typeof Stethoscope }[] = [
  { to: '/doctor/queue', label: 'Open the OPD queue', icon: ClipboardList },
  { to: '/doctor/patients', label: 'Find a patient', icon: Users },
  { to: '/doctor/consultations', label: 'My consultations and drafts', icon: FileSignature },
  { to: '/doctor/ai-review', label: 'Review AI suggestions', icon: BrainCircuit },
]

function ReadyRow({ v, action }: { v: Visit; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid={`ready-${v.tokenNumber}`}>
      <PatientAvatar name={v.patient.fullName} size="md" />
      <div className="min-w-0 flex-1">
        <Link to={`/doctor/patients/${v.patient.id}`} className="block font-semibold break-words text-brand-strong hover:underline">
          {v.patient.fullName}
        </Link>
        <p className="text-xs text-ink-muted">
          {v.patient.mrn} · {ageSex(v.patient)} · Token {v.tokenNumber}
        </p>
        <p className="text-xs">{v.chiefComplaint ?? 'No reason recorded'}</p>
        <AllergySummary noKnownAllergies={v.patient.noKnownAllergies} activeAllergies={v.patient.activeAllergies} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {v.priority === 'urgent' && <Badge tone="down">Urgent</Badge>}
        <VisitStatusBadge status={v.status} />
        {action}
      </div>
    </li>
  )
}

/**
 * The doctor's landing page: how today stands (from the queue and the
 * schedule, nothing invented), today's appointments, the patients who are
 * ready or with the doctor now, and shortcuts to pages that exist.
 */
export function DoctorHomePage({ consultationAction, notice }: { consultationAction?: (v: Visit) => ReactNode; notice?: ReactNode }) {
  const { data: me } = useMe()
  useDocumentTitle('Home')
  const [dialog, setDialog] = useState<AppointmentDialogState>(null)
  const queue = useVisits({ mine: true })
  const today = useAppointments({ scope: 'today', mine: 'true' })

  const visits = queue.data?.visits ?? []
  const count = (...s: Visit['status'][]) => visits.filter((v) => s.includes(v.status)).length
  const upcoming = (today.data?.items ?? []).filter((a) => a.status === 'booked' && !a.overdue).length
  // Patients ready for the doctor first, those already with the doctor before them.
  const ready = visits.filter((v) => v.status === 'ready' || v.status === 'in_consultation').sort((a, b) => Number(b.status === 'in_consultation') - Number(a.status === 'in_consultation'))
  const scheduleRows = (today.data?.items ?? []).filter((a) => a.status !== 'rescheduled').slice(0, SCHEDULE_ROWS)
  const hiddenRows = (today.data?.items ?? []).filter((a) => a.status !== 'rescheduled').length - scheduleRows.length

  return (
    <>
      <PageHeader title="Home" description={[queue.data ? fmtDate(queue.data.date) : null, me?.departmentName, me?.facilityName].filter(Boolean).join(' · ') || undefined} />
      {notice}

      <ul aria-label="Today at a glance" className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="In the queue" value={queue.data ? count('waiting', 'in_triage', 'ready') : undefined} loading={queue.isPending} icon={ClipboardList} tone="brand" hint="Waiting, in triage or ready" />
        <StatCard label="With a doctor" value={queue.data ? count('in_consultation') : undefined} loading={queue.isPending} icon={Stethoscope} tone="warn" hint="Consultation in progress" />
        <StatCard label="Completed today" value={queue.data ? count('completed') : undefined} loading={queue.isPending} icon={CheckCircle2} tone="ok" hint="Signed consultations" />
        <StatCard label="Appointments to come" value={today.data ? upcoming : undefined} loading={today.isPending} icon={CalendarClock} tone="neutral" hint="Booked, not yet arrived" />
      </ul>

      {/* One column until there is room for the side column (1536px): the schedule is a table from 1280px and needs the width. */}
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-3">
        <div className="space-y-6 2xl:col-span-2">
          <Card
            title="Today’s schedule"
            bodyClassName="p-0"
            actions={
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" icon={<CalendarPlus aria-hidden="true" className="size-4" />} onClick={() => setDialog({ kind: 'book' })}>
                  Book appointment
                </Button>
                <Link to="/doctor/appointments" className="inline-flex min-h-control-sm items-center gap-1 rounded-md px-2 text-sm font-medium text-brand-strong hover:underline">
                  All appointments
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </div>
            }
          >
            <div className={today.data && scheduleRows.length > 0 ? '' : 'p-4'}>
              {today.isPending && <LoadingState label="Loading today’s schedule…" />}
              {today.isError && !today.data && <ErrorState title="Today’s schedule could not be loaded" error={today.error} onRetry={() => void today.refetch()} retrying={today.isFetching} />}
              {today.isError && today.data && <p className="px-4 pt-3 text-sm text-pending">The latest update failed, so this may be out of date.</p>}
              {today.data && !scheduleRows.length && (
                <EmptyState icon={CalendarCheck} title="No appointments today">
                  Booked appointments for you appear here.
                </EmptyState>
              )}
              {today.data && scheduleRows.length > 0 && <AppointmentTable items={scheduleRows} canManage onDialog={setDialog} label="Today’s appointments" variant="compact" embedded />}
              {hiddenRows > 0 && (
                <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">
                  {hiddenRows} more today.{' '}
                  <Link to="/doctor/appointments" className="font-medium text-brand-strong underline">
                    See the whole schedule
                  </Link>
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 2xl:grid-cols-1 2xl:content-start">
          <Card title="Ready for you" bodyClassName="p-0" actions={<Link to="/doctor/queue" className="text-sm font-medium text-brand-strong hover:underline">OPD queue</Link>}>
            {queue.isPending && <div className="p-4"><LoadingState rows={2} label="Loading the queue…" /></div>}
            {queue.isError && !queue.data && <div className="p-4"><ErrorState title="The queue could not be loaded" error={queue.error} onRetry={() => void queue.refetch()} retrying={queue.isFetching} /></div>}
            {queue.isError && queue.data && <p className="px-4 pt-3 text-sm text-pending">The latest update failed, so this may be out of date.</p>}
            {queue.data && !ready.length && (
              <div className="p-4">
                <EmptyState icon={Stethoscope} title="No one is ready yet">
                  Patients appear here when the nurse hands them over.
                </EmptyState>
              </div>
            )}
            {ready.length > 0 && (
              <ul className="divide-y divide-line" aria-label="Patients ready or with you">
                {ready.map((v) => (
                  <ReadyRow key={v.id} v={v} action={consultationAction?.(v)} />
                ))}
              </ul>
            )}
          </Card>

          <Card title="Quick actions">
            <ul className="space-y-1" aria-label="Quick actions">
              {QUICK.map(({ to, label, icon: Icon }) => (
                <li key={to}>
                  <Link to={to} className="flex min-h-control items-center gap-3 rounded-lg px-2 text-sm font-medium hover:bg-canvas">
                    <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
                      <Icon className="size-4" />
                    </span>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <AppointmentDialogHost dialog={dialog} onChange={setDialog} />
    </>
  )
}
