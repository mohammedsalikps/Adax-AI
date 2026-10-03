import { OPEN_VISIT_STATUSES, VISIT_TRANSITIONS, type Visit, type VisitStatus } from '@adaxai/contracts'
import { Activity, CalendarPlus, Pencil, Route, XCircle } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AppointmentDialogHost, type AppointmentDialogState } from '../../components/clinical/AppointmentDialogs.tsx'
import { RoutingDialog } from '../../components/clinical/RoutingDialog.tsx'
import { ageSex, AllergySummary } from '../../components/clinical/PatientBanner.tsx'
import { RecordVitalsDialog } from '../../components/clinical/Vitals.tsx'
import { VisitStatusBadge } from '../../components/clinical/VisitStatusBadge.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Badge, EmptyState, ErrorState, LoadingState } from '../../components/ui/Feedback.tsx'
import { TextField } from '../../components/ui/Form.tsx'
import { PageHeader } from '../../components/ui/Layout.tsx'
import { Menu, type MenuItem } from '../../components/ui/Menu.tsx'
import { PatientAvatar } from '../../components/ui/PatientAvatar.tsx'
import { SegmentedControl } from '../../components/ui/SegmentedControl.tsx'
import { TabPanel, Tabs } from '../../components/ui/Tabs.tsx'
import { clockHHMM, fmtClock, useAppointmentOptions } from '../../lib/appointments.ts'
import { useVisits } from '../../lib/clinical.ts'
import { fmtDate } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'
import { CancelDialog, EditVisitDialog } from '../clinical/QueuePage.tsx'

type TabId = 'all' | 'waiting' | 'room' | 'done' | 'closed'

const TAB_STATUSES: Record<Exclude<TabId, 'all'>, VisitStatus[]> = {
  waiting: ['waiting', 'in_triage', 'ready'],
  room: ['in_consultation'],
  done: ['completed'],
  closed: ['cancelled', 'no_show'],
}

type Dialogs = { kind: 'vitals' | 'cancel' | 'edit' | 'routing'; visit: Visit } | null

// A grid row from `xl` up (a table look: every row lines up with the header) and a stacked card below it.
const GRID = 'xl:grid-cols-[3rem_6.5rem_minmax(0,1.6fr)_minmax(0,1.4fr)_9rem_minmax(11rem,auto)]'

function Row({ visit, timezone, consultationAction, onOpen }: { visit: Visit; timezone: string | undefined; consultationAction?: ((v: Visit) => ReactNode) | undefined; onOpen: (d: NonNullable<Dialogs>) => void }) {
  const open = OPEN_VISIT_STATUSES.includes(visit.status)
  const can = (to: VisitStatus) => VISIT_TRANSITIONS[visit.status].includes(to)
  const items: MenuItem[] = []
  if (open && visit.status !== 'in_consultation') {
    items.push({ label: 'Record vitals', icon: <Activity aria-hidden="true" className="size-4" />, onSelect: () => onOpen({ kind: 'vitals', visit }) })
    items.push({ label: 'Routing…', icon: <Route aria-hidden="true" className="size-4" />, onSelect: () => onOpen({ kind: 'routing', visit }) })
    items.push({ label: 'Edit visit…', icon: <Pencil aria-hidden="true" className="size-4" />, onSelect: () => onOpen({ kind: 'edit', visit }) })
  }
  if (open && can('cancelled')) items.push({ label: 'Cancel visit…', tone: 'danger', icon: <XCircle aria-hidden="true" className="size-4" />, onSelect: () => onOpen({ kind: 'cancel', visit }) })
  return (
    <li className={`grid items-start gap-x-4 gap-y-2 px-4 py-3.5 xl:min-h-row xl:items-center ${GRID} ${visit.priority === 'urgent' && open ? 'bg-down-soft/30' : ''}`} data-testid={`queue-row-${visit.tokenNumber}`}>
      <p className="text-sm font-semibold text-ink-muted tabular-nums">
        <span className="xl:hidden">Token </span>
        {visit.tokenNumber}
      </p>
      <div>
        <p className="text-base font-semibold tabular-nums">{fmtClock(visit.appointment?.localTime ?? clockHHMM(visit.checkedInAt, timezone))}</p>
        <p className="text-xs text-ink-muted">{visit.appointment ? 'Appointment' : 'Walk-in'}</p>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <PatientAvatar name={visit.patient.fullName} size="md" />
        <div className="min-w-0">
          <Link to={`/doctor/patients/${visit.patient.id}`} className="block font-semibold break-words text-brand-strong hover:underline">
            {visit.patient.fullName}
          </Link>
          <p className="text-xs text-ink-muted">
            {ageSex(visit.patient)} · {visit.patient.mrn}
          </p>
          <AllergySummary noKnownAllergies={visit.patient.noKnownAllergies} activeAllergies={visit.patient.activeAllergies} />
        </div>
      </div>
      <div className="min-w-0 text-sm">
        <p className="break-words">{visit.chiefComplaint ? `“${visit.chiefComplaint}”` : 'No reason recorded'}</p>
        <p className="text-xs text-ink-muted">
          {visit.departmentName} · {visit.assignedDoctorName ?? 'Any doctor'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <VisitStatusBadge status={visit.status} />
        {visit.priority === 'urgent' && <Badge tone="down">Urgent</Badge>}
      </div>
      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        {open && consultationAction?.(visit)}
        {items.length > 0 && <Menu label={`More actions for ${visit.patient.fullName}, token ${visit.tokenNumber}`} items={items} />}
      </div>
    </li>
  )
}

/**
 * The doctor's list of the day's patients, as in the clinical-workstation
 * design: filter tabs with counts (all, waiting, in the room, completed,
 * closed), a day picker, and one row per visit with its time, the patient
 * (with allergies always shown), the reason and status, and the action that
 * moves the patient on. The quieter actions (vitals, routing, edit, cancel)
 * are in the row's menu. The queue is shared with nurses and refreshes itself.
 */
export function TodaysPatientsPage({ consultationAction, notice }: { consultationAction?: (v: Visit) => ReactNode; notice?: ReactNode }) {
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const [day, setDay] = useState('')
  const [tab, setTab] = useState<TabId>('all')
  const [dialog, setDialog] = useState<Dialogs>(null)
  const [appointmentDialog, setAppointmentDialog] = useState<AppointmentDialogState>(null)
  const q = useVisits({ mine: scope === 'mine', date: day || undefined })
  const visits = q.data?.visits ?? []
  const timezone = useAppointmentOptions().data?.timezone
  // The API answers with the day it was asked for, so "today" is what it said when no day was chosen.
  const [today, setToday] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!day && q.data) setToday(q.data.date)
  }, [day, q.data])
  const inTab = (t: TabId) => (t === 'all' ? visits : visits.filter((v) => TAB_STATUSES[t].includes(v.status)))
  const shown = inTab(tab)
  // Patients ready for the doctor first, then those already in the room, then the rest in queue order.
  const rank = (v: Visit) => (v.status === 'in_consultation' ? 0 : v.status === 'ready' ? 1 : OPEN_VISIT_STATUSES.includes(v.status) ? 2 : 3)
  const ordered = [...shown].sort((a, b) => rank(a) - rank(b))
  const isToday = !day || day === today
  const title = isToday ? 'Today’s patients' : `Patients on ${fmtDate(day)}`
  useDocumentTitle(title)

  return (
    <>
      <PageHeader
        title={title}
        description={q.data ? `${new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${q.data.date}T00:00:00`))}${isToday ? ' · updates automatically' : ''}` : undefined}
        actions={
          <>
            <div className="w-44">
              <TextField label={<span className="sr-only">Day</span>} type="date" value={day || today || ''} onChange={(e) => setDay(e.target.value === today ? '' : e.target.value)} />
            </div>
            <Button icon={<CalendarPlus aria-hidden="true" className="size-4" />} onClick={() => setAppointmentDialog({ kind: 'book' })}>
              New appointment
            </Button>
          </>
        }
      />
      {notice}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs
          variant="pill"
          label="Which patients"
          prefix="today"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'all', label: 'All', count: q.data ? visits.length : undefined },
            { id: 'waiting', label: 'Waiting', count: q.data ? inTab('waiting').length : undefined },
            { id: 'room', label: 'In the room', count: q.data ? inTab('room').length : undefined },
            { id: 'done', label: 'Completed', count: q.data ? inTab('done').length : undefined },
            { id: 'closed', label: 'Cancelled or no-show', count: q.data ? inTab('closed').length : undefined },
          ]}
        />
        <SegmentedControl
          label="Whose patients"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'mine', label: 'My patients' },
            { value: 'all', label: 'Whole clinic' },
          ]}
        />
      </div>
      {q.isPending && <LoadingState rows={4} label="Loading the patients…" />}
      {q.isError && !q.data && <ErrorState title="The patients could not be loaded" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
      {q.isError && q.data && <p className="mb-3 text-sm text-pending">The latest update failed, so this may be out of date.</p>}
      {/* Every tab has its panel in the page (its tab points at it); only the chosen one has content. */}
      {(['all', 'waiting', 'room', 'done', 'closed'] as const).map((t) => (
        <TabPanel key={t} prefix="today" id={t} active={t === tab} focusable={false}>
          {t === tab && q.data && (!ordered.length ? (
            <EmptyState title={visits.length ? 'No patients in this group' : isToday ? 'No patients in the queue yet' : 'No patients that day'}>{visits.length ? 'Choose another group above.' : 'Patients appear here when they are checked in.'}</EmptyState>
          ) : (
            <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
              <div aria-hidden="true" className={`hidden gap-x-4 border-b border-line bg-canvas px-4 py-2.5 text-xs font-medium tracking-wide text-ink-muted uppercase xl:grid ${GRID}`}>
                <span>#</span>
                <span>Time</span>
                <span>Patient</span>
                <span>Reason and clinician</span>
                <span>Status</span>
                <span className="xl:text-right">Actions</span>
              </div>
              <ul className="divide-y divide-line" aria-label="Visits">
                {ordered.map((v) => (
                  <Row key={v.id} visit={v} timezone={timezone} consultationAction={consultationAction} onOpen={setDialog} />
                ))}
              </ul>
            </div>
          ))}
        </TabPanel>
      ))}
      {!isToday && <p className="mt-3 text-sm text-ink-muted">{fmtDate(day)} is not today: this is that day’s record, and its patients are no longer in the live queue.</p>}
      {dialog?.kind === 'vitals' && <RecordVitalsDialog visitId={dialog.visit.id} patientName={dialog.visit.patient.fullName} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'cancel' && <CancelDialog visit={dialog.visit} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <EditVisitDialog visit={dialog.visit} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'routing' && <RoutingDialog visit={dialog.visit} onClose={() => setDialog(null)} />}
      <AppointmentDialogHost dialog={appointmentDialog} onChange={setAppointmentDialog} />
    </>
  )
}
