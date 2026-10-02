import { OPEN_VISIT_STATUSES, type Visit } from '@adaxai/contracts'
import { Stethoscope } from 'lucide-react'
import { Link } from 'react-router'
import { errorMessage } from '../../lib/api.ts'
import { usePortalBase } from '../../lib/clinical.ts'
import { useStartConsultation } from '../../lib/encounters.ts'
import { Button } from '../ui/Button.tsx'
import { useToast } from '../ui/Toast.tsx'

/** Doctor queue action: start, continue or view the consultation for a visit. */
export function ConsultAction({ visit }: { visit: Visit }) {
  const start = useStartConsultation()
  const toast = useToast()
  if (!OPEN_VISIT_STATUSES.includes(visit.status)) return null
  const resuming = visit.status === 'in_consultation' && visit.encounterId
  return (
    <Button
      size="sm"
      icon={<Stethoscope aria-hidden="true" className="size-4" />}
      loading={start.isPending}
      onClick={() => start.mutate(visit.id, { onError: (e) => toast('error', errorMessage(e)) })}
    >
      {resuming ? 'Continue consultation' : 'Start consultation'}
    </Button>
  )
}

/** Link to a visit's consultation from history tables (doctor and nurse). */
export function ConsultationLink({ visit }: { visit: Visit }) {
  const base = usePortalBase()
  if (!visit.encounterId) return null
  return (
    <Link to={`${base}/encounters/${visit.encounterId}`} className="text-sm font-medium whitespace-nowrap text-brand-strong underline underline-offset-2">
      Open consultation
    </Link>
  )
}
