import { SEX_LABELS, type Sex } from '@adaxai/contracts'
import { TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { ageFrom, fmtDate } from '../../lib/format.ts'

export interface BannerPatient {
  fullName: string
  mrn: string
  sex: Sex
  dateOfBirth: string
  dateOfBirthEstimated?: boolean
  phone?: string
  noKnownAllergies: boolean
  activeAllergies: string[]
}

export const ageSex = (p: { dateOfBirth: string; sex: Sex; dateOfBirthEstimated?: boolean }) =>
  `${p.dateOfBirthEstimated ? '~' : ''}${ageFrom(p.dateOfBirth)} y · ${SEX_LABELS[p.sex]}`

/** Allergy status is always shown explicitly: allergies, "No known allergies", or "not recorded". */
export function AllergySummary({ noKnownAllergies, activeAllergies }: { noKnownAllergies: boolean; activeAllergies: string[] }) {
  if (activeAllergies.length) {
    return (
      <span className="inline-flex items-start gap-1 text-sm font-medium text-down">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>Allergies: {activeAllergies.join(', ')}</span>
      </span>
    )
  }
  if (noKnownAllergies) return <span className="text-sm text-ink-muted">No known allergies</span>
  return <span className="text-sm font-medium text-pending">Allergies not recorded</span>
}

/**
 * Persistent identity banner on every patient-context screen, so the right
 * patient is always visible (wrong-patient errors are a key safety risk).
 */
export function PatientBanner({ patient, actions }: { patient: BannerPatient; actions?: ReactNode }) {
  return (
    <section aria-label="Patient" className="mb-6 rounded-xl border border-line bg-surface px-5 py-4" data-testid="patient-banner">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-xl font-semibold tracking-tight">{patient.fullName}</p>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
            <span>
              MRN <span className="font-mono font-medium text-ink">{patient.mrn}</span>
            </span>
            <span>{ageSex(patient)}</span>
            <span>DOB {fmtDate(patient.dateOfBirth)}</span>
            {patient.phone && <span>{patient.phone}</span>}
          </p>
          <AllergySummary noKnownAllergies={patient.noKnownAllergies} activeAllergies={patient.activeAllergies} />
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </section>
  )
}
