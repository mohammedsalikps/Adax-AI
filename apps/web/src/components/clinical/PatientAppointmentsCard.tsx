import type { PatientDetail } from '@adaxai/contracts'
import { CalendarCheck, CalendarPlus } from 'lucide-react'
import { useState } from 'react'
import { fmtClock, usePatientAppointments } from '../../lib/appointments.ts'
import { fmtDate } from '../../lib/format.ts'
import { Button } from '../ui/Button.tsx'
import { Badge, EmptyState, ErrorState, LoadingState } from '../ui/Feedback.tsx'
import { Card } from '../ui/Layout.tsx'
import { CheckInButton } from './AppointmentDetail.tsx'
import { AppointmentStatusBadge, LinkedVisit, NotToldBadge } from './AppointmentBits.tsx'
import { AppointmentDialogHost, type AppointmentDialogState } from './AppointmentDialogs.tsx'

/** One patient's appointments on their record, with booking for them. */
export function PatientAppointmentsCard({ p }: { p: PatientDetail }) {
  const q = usePatientAppointments(p.id)
  const [dialog, setDialog] = useState<AppointmentDialogState>(null)
  return (
    <Card
      title="Appointments"
      actions={
        <Button size="sm" variant="secondary" icon={<CalendarPlus aria-hidden="true" className="size-4" />} onClick={() => setDialog({ kind: 'book' })}>
          Book appointment
        </Button>
      }
    >
      {q.isPending && <LoadingState rows={2} label="Loading appointments…" />}
      {q.isError && <ErrorState title="Appointments could not be loaded" error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />}
      {q.data && !q.data.items.length && (
        <EmptyState icon={CalendarCheck} title="No appointments yet">
          Book one for this patient with the button above.
        </EmptyState>
      )}
      {q.data && q.data.items.length > 0 && (
        <ul className="divide-y divide-line" aria-label="Appointments of this patient">
          {q.data.items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0" data-testid={`patient-appointment-${a.id}`}>
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {fmtDate(a.localDate)}, {fmtClock(a.localTime)}
                  <AppointmentStatusBadge status={a.status} />
                  {a.overdue && <Badge tone="warn">Awaiting an outcome</Badge>}
                  <NotToldBadge appointment={a} />
                </p>
                <p className="text-xs text-ink-muted">
                  {a.departmentName} · {a.doctorName ?? 'Any doctor'}
                  {a.reason ? ` · “${a.reason}”` : ''}
                </p>
                <LinkedVisit appointment={a} />
              </div>
              <div className="flex flex-wrap gap-2">
                <CheckInButton a={a} />
                <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'detail', id: a.id })}>
                  Details
                  <span className="sr-only">
                    {' '}
                    of the appointment on {fmtDate(a.localDate)} at {fmtClock(a.localTime)}
                  </span>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <AppointmentDialogHost dialog={dialog} onChange={setDialog} patient={{ id: p.id, fullName: p.fullName, mrn: p.mrn }} />
    </Card>
  )
}
