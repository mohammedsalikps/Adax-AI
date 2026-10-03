import type { Encounter } from '@adaxai/contracts'
import { VITALS } from '@adaxai/contracts'
import { CalendarDays, HeartPulse } from 'lucide-react'
import { usePatient } from '../../lib/clinical.ts'
import { fmtDate, fmtTime } from '../../lib/format.ts'
import { usePatientHistory } from '../../lib/history.ts'
import { latestPerKind, vitalsStatus } from '../../lib/vitals.ts'
import { Button } from '../ui/Button.tsx'
import { Badge } from '../ui/Feedback.tsx'
import { PatientAvatar } from '../ui/PatientAvatar.tsx'
import { AllergyItems } from './AllergyItems.tsx'
import { ageSex } from './PatientBanner.tsx'

/** Name, MRN and allergies on one line: what stays in view, with the consultation bar, once the banner has scrolled away. */
export function PatientStrip({ encounter }: { encounter: Encounter }) {
  const p = encounter.patient
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="patient-strip">
      <p className="font-semibold break-words">
        {p.fullName}
        <span className="font-normal text-ink-muted">
          {' '}
          · MRN <span className="font-mono text-ink">{p.mrn}</span>
        </span>
      </p>
      <ul className="flex flex-wrap items-center gap-1.5" aria-label="Allergies">
        <AllergyItems encounter={encounter} />
      </ul>
    </div>
  )
}

/**
 * The patient at the top of a consultation: who they are, what to be careful of
 * (allergies with their severity, known conditions) and how this visit's latest
 * vital signs stand against the adult reference range. The allergy chips come
 * from the patient's record and fall back to the consultation's own list if the
 * record cannot be read (see `AllergyItems`).
 */
export function ConsultationBanner({ encounter, onOpenProfile }: { encounter: Encounter; onOpenProfile: () => void }) {
  const p = encounter.patient
  const detail = usePatient(p.id)
  const history = usePatientHistory(p.id, { poll: true })
  const open = (history.data?.conditions ?? []).filter((c) => c.status !== 'resolved')
  const status = vitalsStatus(encounter.vitals)
  const latest = latestPerKind(encounter.vitals)
  const newest = latest.map((v) => v.measuredAt).sort().at(-1)
  const outsideNames = status.outside.map((o) => VITALS[o.kind].label).join(', ')
  const notes = [`Recorded ${fmtTime(newest)}`, status.flagged ? 'adult range, a display aid' : 'no reference range applies to these readings (adult ranges only)', status.fromDevice ? `${status.fromDevice} from a device that is not validated` : null].filter(Boolean).join('; ')

  return (
    <section aria-label="Patient" className="mb-4 rounded-xl border border-line bg-surface p-4 shadow-card" data-testid="patient-banner">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <PatientAvatar name={p.fullName} size="lg" />
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <p className="text-xl font-semibold tracking-tight break-words">{p.fullName}</p>
            <p className="text-sm text-ink-muted">
              {ageSex(p)} · MRN <span className="font-mono font-medium text-ink">{p.mrn}</span>
              {detail.data?.bloodGroup ? ` · ${detail.data.bloodGroup}` : ''}
            </p>
            {detail.data && detail.data.dataOrigin !== 'clinical' && <Badge>Synthetic</Badge>}
          </div>
          <ul className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Allergies and conditions">
            <AllergyItems encounter={encounter} />
            {open.slice(0, 4).map((c) => (
              <li key={c.id}>
                <Badge tone="notice" wrap>
                  {c.name}
                </Badge>
              </li>
            ))}
            {open.length > 4 && (
              <li>
                <Badge wrap>+{open.length - 4} more conditions</Badge>
              </li>
            )}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <p className="flex items-start gap-2 text-ink-muted">
            <CalendarDays aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block font-medium text-ink">
                Token {encounter.visit.tokenNumber} · {encounter.visit.departmentName}
              </span>
              <span className="block">{fmtDate(encounter.visit.visitDate)}</span>
            </span>
          </p>
          {status.total > 0 && (
            <p className="flex max-w-80 items-start gap-2">
              <HeartPulse aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
              <span>
                {status.flagged ? (
                  <Badge tone={status.outside.length ? 'warn' : 'ok'} dot wrap>
                    {status.outside.length ? `${status.outside.length} vital sign${status.outside.length === 1 ? '' : 's'} outside the reference range` : 'Latest vitals within the reference range'}
                  </Badge>
                ) : (
                  <Badge wrap>Vital signs recorded</Badge>
                )}
                <span className="mt-0.5 block text-xs text-ink-muted">
                  {status.outside.length ? `${outsideNames}. ` : ''}
                  {notes}.
                </span>
              </span>
            </p>
          )}
          <Button variant="secondary" size="sm" onClick={onOpenProfile}>
            View profile
          </Button>
        </div>
      </div>
    </section>
  )
}
