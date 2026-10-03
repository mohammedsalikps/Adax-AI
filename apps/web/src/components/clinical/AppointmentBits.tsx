import { APPOINTMENT_STATUS_LABELS, type Appointment, type AppointmentStatus } from '@adaxai/contracts'
import { BellOff } from 'lucide-react'
import { Link } from 'react-router'
import { useMe } from '../../lib/auth.tsx'
import { usePortalQueuePath } from '../../lib/clinical.ts'
import { Badge, type BadgeTone } from '../ui/Feedback.tsx'
import { VisitStatusBadge } from './VisitStatusBadge.tsx'

const TONE: Record<AppointmentStatus, BadgeTone> = {
  booked: 'brand',
  checked_in: 'warn',
  completed: 'ok',
  cancelled: 'neutral',
  rescheduled: 'neutral',
  no_show: 'down',
}

export const AppointmentStatusBadge = ({ status }: { status: AppointmentStatus }) => (
  <Badge tone={TONE[status]} dot>
    {APPOINTMENT_STATUS_LABELS[status]}
  </Badge>
)

/**
 * A warning on the schedule where the patient may be left in the dark: a
 * cancellation they were not told about (they may still turn up), or a message
 * the channel failed to deliver. A booking for a patient with no portal account
 * is the normal state (the portal is the only channel), so it is not flagged on
 * every row; the appointment's details and the toast after booking say it.
 */
export function NotToldBadge({ appointment }: { appointment: Pick<Appointment, 'patientMessage' | 'status'> }) {
  const m = appointment.patientMessage
  if (!m || m.status === 'delivered') return null
  const risky = (appointment.status === 'cancelled' && m.status !== 'queued') || (appointment.status === 'booked' && m.status === 'failed')
  if (!risky) return null
  return (
    <Badge tone="warn" icon={<BellOff aria-hidden="true" className="size-3" />}>
      Patient not told
    </Badge>
  )
}

/** The visit an appointment became (token and where it is in the queue), shown wherever the appointment is. */
export function LinkedVisit({ appointment }: { appointment: Pick<Appointment, 'visit'> }) {
  const queuePath = usePortalQueuePath()
  const { data: me } = useMe()
  const v = appointment.visit
  if (!v) return null
  // Administrators have no queue to open.
  const canOpen = me?.role === 'doctor' || me?.role === 'nurse'
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="linked-visit">
      <span>
        Visit: token <strong>{v.tokenNumber}</strong>
      </span>
      <VisitStatusBadge status={v.status} />
      {canOpen && (
        <Link to={queuePath} className="text-xs font-medium text-brand-strong underline underline-offset-2">
          Open the queue
        </Link>
      )}
    </p>
  )
}
