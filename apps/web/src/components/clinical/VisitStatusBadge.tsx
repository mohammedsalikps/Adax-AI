import { VISIT_STATUS_LABELS, type VisitStatus } from '@adaxai/contracts'
import { Badge } from '../ui/Feedback.tsx'

const TONES: Record<VisitStatus, 'neutral' | 'notice' | 'brand' | 'warn' | 'ok'> = {
  waiting: 'neutral',
  in_triage: 'notice',
  ready: 'brand',
  in_consultation: 'warn',
  completed: 'ok',
  cancelled: 'neutral',
  no_show: 'neutral',
}

export function VisitStatusBadge({ status }: { status: VisitStatus }) {
  return <Badge tone={TONES[status]}>{VISIT_STATUS_LABELS[status]}</Badge>
}
