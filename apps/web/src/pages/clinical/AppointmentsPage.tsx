import { type Appointment, APPOINTMENT_STATUS_LABELS, type AppointmentStatus } from '@adaxai/contracts'
import { CalendarDays, CalendarPlus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AppointmentDialogHost, type AppointmentDialogState } from '../../components/clinical/AppointmentDialogs.tsx'
import { AppointmentTable } from '../../components/clinical/AppointmentTable.tsx'
import { Button } from '../../components/ui/Button.tsx'
import { Alert, EmptyState, ErrorState, LoadingState } from '../../components/ui/Feedback.tsx'
import { TextField } from '../../components/ui/Form.tsx'
import { PageHeader } from '../../components/ui/Layout.tsx'
import { SegmentedControl } from '../../components/ui/SegmentedControl.tsx'
import { useAppointments } from '../../lib/appointments.ts'
import { useMe } from '../../lib/auth.tsx'
import { fmtDate } from '../../lib/format.ts'
import { useDocumentTitle } from '../../lib/useDocumentTitle.ts'

type Scope = 'today' | 'upcoming' | 'past' | 'date'
const SCOPES: { value: Scope; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'date', label: 'A date' },
]
const STATUSES: AppointmentStatus[] = ['booked', 'checked_in', 'completed', 'no_show', 'cancelled']
const EMPTY: Record<Scope, string> = { today: 'No appointments today', upcoming: 'No upcoming appointments', past: 'No appointments in the last 90 days', date: 'No appointments on that day' }

/**
 * The schedule, on the clinic's clock: today, upcoming, past, or one day.
 * Doctors and nurses see patients and can act; a doctor can limit the list to
 * their own patients; administrators see the facility's schedule without
 * patient identity or free text and cannot change it (the server decides).
 * The search box filters the loaded list on this device: nothing is sent.
 */
export function AppointmentsPage() {
  const { data: me } = useMe()
  const role = me?.role
  const canManage = role === 'doctor' || role === 'nurse'
  useDocumentTitle('Appointments')
  const [scope, setScope] = useState<Scope>('today')
  const [date, setDate] = useState('')
  const [status, setStatus] = useState<'all' | AppointmentStatus>('all')
  const [mine, setMine] = useState(role === 'doctor')
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<AppointmentDialogState>(null)
  const ready = scope !== 'date' || !!date
  const q = useAppointments({ scope, date: scope === 'date' ? date : undefined, status: status === 'all' ? undefined : status, mine: mine ? 'true' : undefined }, ready)

  const term = search.trim().toLowerCase()
  const items = useMemo(() => {
    const all = q.data?.items ?? []
    return term ? all.filter((a) => a.patient && (a.patient.fullName.toLowerCase().includes(term) || a.patient.mrn.toLowerCase().includes(term))) : all
  }, [q.data, term])
  const groups = items.reduce<[string, Appointment[]][]>((acc, a) => {
    const last = acc.at(-1)
    if (last && last[0] === a.localDate) last[1].push(a)
    else acc.push([a.localDate, [a]])
    return acc
  }, [])
  const total = STATUSES.reduce((n, s) => n + (q.data?.counts[s] ?? 0), 0)

  return (
    <>
      <PageHeader
        title="Appointments"
        description={q.data ? `Times are on the clinic’s clock (${q.data.timezone}). Today is ${fmtDate(q.data.today)}.` : undefined}
        actions={
          canManage ? (
            <Button icon={<CalendarPlus aria-hidden="true" className="size-4" />} onClick={() => setDialog({ kind: 'book' })}>
              Book appointment
            </Button>
          ) : undefined
        }
      />
      {role === 'admin' && (
        <Alert tone="info" className="mb-4">
          Patient names and reasons are not shown to administrators. This is the facility’s schedule only.
        </Alert>
      )}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <SegmentedControl label="Which appointments" value={scope} onChange={setScope} options={SCOPES} />
        {scope === 'date' && <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />}
        {role === 'doctor' && (
          <SegmentedControl
            label="Whose patients"
            value={mine ? 'mine' : 'all'}
            onChange={(v) => setMine(v === 'mine')}
            options={[
              { value: 'mine', label: 'My schedule' },
              { value: 'all', label: 'Whole clinic' },
            ]}
          />
        )}
        {canManage && (
          <div className="relative w-full sm:ml-auto sm:max-w-xs">
            <label htmlFor="appointment-search" className="sr-only">
              Filter this list by patient name or MRN
            </label>
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" />
            <input
              id="appointment-search"
              type="search"
              autoComplete="off"
              placeholder="Filter by patient name or MRN"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block min-h-control w-full rounded-lg border border-control bg-surface pr-3 pl-9 text-sm shadow-card placeholder:text-ink-muted"
            />
          </div>
        )}
      </div>
      <div className="mb-5">
        <SegmentedControl
          label="Filter by status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: <>All{q.data && <span className="ml-1.5 tabular-nums opacity-70">{total}</span>}</> },
            ...STATUSES.map((s) => ({ value: s, label: <>{APPOINTMENT_STATUS_LABELS[s]}{q.data && <span className="ml-1.5 tabular-nums opacity-70">{q.data.counts[s] ?? 0}</span>}</> })),
          ]}
        />
      </div>

      {scope === 'date' && !date && (
        <EmptyState icon={CalendarDays} title="Choose a date">
          Pick the day to look at.
        </EmptyState>
      )}
      {ready && q.isPending && <LoadingState label="Loading the schedule…" />}
      {q.isError && !q.data && <ErrorState title="Cannot load the schedule" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
      {q.isError && q.data && (
        <Alert tone="warning" className="mb-4">
          The latest update failed, so this may be out of date.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void q.refetch()}>
            Try again
          </button>
        </Alert>
      )}
      {q.data?.truncated && (
        <Alert tone="warning" className="mb-4">
          Only the first {q.data.items.length} appointments are shown. Narrow the list with the status filter or a date.
        </Alert>
      )}
      {q.data && !items.length && (
        <EmptyState
          icon={CalendarDays}
          title={term ? 'No appointment matches that search' : EMPTY[scope]}
          action={
            canManage && !term ? (
              <Button variant="secondary" onClick={() => setDialog({ kind: 'book' })}>
                Book appointment
              </Button>
            ) : undefined
          }
        >
          {term ? 'Only the appointments listed for this view are searched.' : status !== 'all' || mine ? 'Try another status, or the whole clinic.' : 'Booked appointments appear here.'}
        </EmptyState>
      )}
      {groups.map(([day, list]) => (
        <section key={day} className="mb-6" aria-labelledby={`day-${day}`}>
          <h2 id={`day-${day}`} className={scope === 'today' ? 'sr-only' : 'mb-2 text-base font-semibold'}>
            {fmtDate(day)}
          </h2>
          <AppointmentTable items={list} canManage={canManage} onDialog={setDialog} label={`Appointments on ${fmtDate(day)}`} />
        </section>
      ))}

      <AppointmentDialogHost dialog={dialog} onChange={setDialog} />
    </>
  )
}
