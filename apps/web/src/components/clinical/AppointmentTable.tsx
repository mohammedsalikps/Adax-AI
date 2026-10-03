import type { Appointment } from '@adaxai/contracts'
import { Link } from 'react-router'
import { fmtClock } from '../../lib/appointments.ts'
import { usePortalBase } from '../../lib/clinical.ts'
import { Button } from '../ui/Button.tsx'
import { Badge } from '../ui/Feedback.tsx'
import { PatientAvatar } from '../ui/PatientAvatar.tsx'
import { CheckInButton } from './AppointmentDetail.tsx'
import { AppointmentStatusBadge, LinkedVisit, NotToldBadge } from './AppointmentBits.tsx'
import type { AppointmentDialogState } from './AppointmentDialogs.tsx'

// Static class strings so Tailwind can see them. Rows are grid rows from `xl` up (a table look: the columns have fixed or
// proportional widths, so every row lines up with the header), and stacked cards below it, where there is no room for columns.
const GRID = {
  full: 'xl:grid-cols-[6.5rem_minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(9rem,1fr)_12rem]',
  compact: 'xl:grid-cols-[6rem_minmax(0,1.5fr)_minmax(8rem,1fr)_12rem]',
} as const
const ROW_HEIGHT = { full: 'xl:min-h-row', compact: 'xl:min-h-row-compact' } as const

function Row({ a, variant, canManage, onDialog }: { a: Appointment; variant: keyof typeof GRID; canManage: boolean; onDialog: (d: AppointmentDialogState) => void }) {
  const base = usePortalBase()
  const full = variant === 'full'
  return (
    <li className={`grid items-start gap-x-4 gap-y-2 px-4 py-3.5 xl:items-center ${ROW_HEIGHT[variant]} ${GRID[variant]} ${a.overdue ? 'bg-pending-soft/30' : ''}`} data-testid={`appointment-${a.id}`}>
      <div className="flex items-baseline gap-2 xl:block">
        <p className="text-base font-semibold tabular-nums">{fmtClock(a.localTime)}</p>
        <p className="text-xs text-ink-muted">{a.durationMinutes} min</p>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {a.patient ? (
          <>
            <PatientAvatar name={a.patient.fullName} size="md" />
            <div className="min-w-0">
              <Link to={`${base}/patients/${a.patient.id}`} className="block font-semibold break-words text-brand-strong hover:underline">
                {a.patient.fullName}
              </Link>
              <p className="text-xs text-ink-muted">
                {a.patient.mrn}
                {full && a.reason ? ` · “${a.reason}”` : ''}
              </p>
            </div>
          </>
        ) : (
          <span className="text-sm text-ink-muted">Patient not shown</span>
        )}
      </div>
      {full && (
        <div className="min-w-0 text-sm">
          <p className="break-words">{a.doctorName ?? 'Any doctor'}</p>
          <p className="text-xs text-ink-muted">{a.departmentName}</p>
        </div>
      )}
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <AppointmentStatusBadge status={a.status} />
          {a.overdue && <Badge tone="warn">Awaiting an outcome</Badge>}
          <NotToldBadge appointment={a} />
        </div>
        <LinkedVisit appointment={a} />
      </div>
      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        <CheckInButton a={a} />
        {canManage && (
          <Button size="sm" variant="ghost" onClick={() => onDialog({ kind: 'detail', id: a.id })}>
            Details
            <span className="sr-only"> of the appointment at {fmtClock(a.localTime)}</span>
          </Button>
        )}
      </div>
    </li>
  )
}

/**
 * The schedule as a table on wide screens and as stacked cards on phones.
 * Every row carries the actions the server allows for this user right now;
 * the header is decorative (each cell says what it is), so the list reads
 * naturally to assistive technology and keeps one structure at every width.
 * `embedded` drops the outer frame, for use inside a card that has its own.
 */
export function AppointmentTable({ items, canManage, onDialog, label, variant = 'full', embedded = false }: { items: Appointment[]; canManage: boolean; onDialog: (d: AppointmentDialogState) => void; label: string; variant?: keyof typeof GRID; embedded?: boolean }) {
  const full = variant === 'full'
  return (
    <div className={embedded ? 'overflow-hidden' : 'overflow-hidden rounded-xl border border-line bg-surface shadow-card'}>
      <div aria-hidden="true" className={`hidden gap-x-4 border-b border-line bg-canvas px-4 py-2.5 text-xs font-medium tracking-wide text-ink-muted uppercase xl:grid ${GRID[variant]}`}>
        <span>Time</span>
        <span>Patient</span>
        {full && <span>Clinician</span>}
        <span>Status</span>
        <span className="xl:text-right">Actions</span>
      </div>
      <ul className="divide-y divide-line" aria-label={label}>
        {items.map((a) => (
          <Row key={a.id} a={a} variant={variant} canManage={canManage} onDialog={onDialog} />
        ))}
      </ul>
    </div>
  )
}
