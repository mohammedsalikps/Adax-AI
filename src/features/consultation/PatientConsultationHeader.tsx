import { CalendarCheck, Droplet, ShieldAlert, TriangleAlert } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { calculateAge, formatDate, formatRelativeToNow } from '@/lib/format'
import type { Patient } from '@/types/patient'

const SEX_LABEL: Record<Patient['sex'], string> = {
  male: 'Male',
  female: 'Female',
  other: 'Other',
}

interface FactProps {
  icon: typeof Droplet
  label: string
  children: React.ReactNode
  /** Warning tone for the icon when the fact itself is a risk. */
  alert?: boolean
}

function Fact({ icon: Icon, label, children, alert = false }: FactProps) {
  return (
    <div className="min-w-0 px-4 first:pl-0 last:pr-0 sm:border-l sm:border-line sm:first:border-l-0">
      <p className="text-[11px] font-medium text-ink-muted">{label}</p>
      <div className="mt-1 flex items-center gap-1.5">
        <Icon
          size={15}
          className={alert ? 'shrink-0 text-critical' : 'shrink-0 text-accent'}
          aria-hidden
        />
        <div className="min-w-0 text-[13px] font-semibold text-ink">{children}</div>
      </div>
    </div>
  )
}

export interface PatientConsultationHeaderProps {
  patient: Patient
  /** Opens the full chart — photo, name and the whole card are wired to it. */
  onOpenProfile: () => void
}

/**
 * Identity banner across the top of the consultation workspace: who the chart
 * belongs to, and the three facts that change prescribing decisions — blood
 * group, allergies and when they were last seen.
 *
 * Allergies are deliberately shown in full here rather than as a count. On a
 * phone the detailed allergy panel sits far below the prescription step, so
 * this banner is where that risk has to be legible.
 */
export function PatientConsultationHeader({
  patient,
  onOpenProfile,
}: PatientConsultationHeaderProps) {
  const age = calculateAge(patient.dateOfBirth)
  const allergies = patient.allergies
  const hasAllergies = allergies.length > 0

  return (
    <section
      aria-label="Patient identity"
      className="rounded-panel border border-line bg-surface p-3.5 shadow-card sm:p-4"
    >
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
        {/* ------------------------------------------------ identity */}
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <button
            type="button"
            onClick={onOpenProfile}
            aria-label={`Open full chart for ${patient.fullName}`}
            className="shrink-0 rounded-full transition-opacity hover:opacity-85"
          >
            <Avatar
              src={patient.photoUrl}
              name={patient.fullName}
              size="xl"
              decorative
              className="border-2 border-accent-soft"
            />
          </button>

          <div className="min-w-0">
            <button
              type="button"
              onClick={onOpenProfile}
              className="max-w-full truncate text-left text-lg font-bold tracking-tight text-ink transition-colors hover:text-accent sm:text-xl"
            >
              {patient.fullName}
            </button>

            <p className="tnum mt-0.5 truncate text-xs text-ink-soft sm:text-[13px]">
              {patient.id}
              <span className="mx-1.5 text-ink-muted">|</span>
              {age} yrs
              <span className="mx-1.5 text-ink-muted">|</span>
              {SEX_LABEL[patient.sex]}
            </p>

            {patient.chronicConditions.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {patient.chronicConditions.map((condition) => (
                  <Badge key={condition} variant="neutral">
                    {condition}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------ key facts */}
        <div className="grid grid-cols-2 gap-y-3 border-t border-line pt-3 sm:grid-cols-3 xl:flex xl:shrink-0 xl:border-t-0 xl:pt-0">
          <Fact icon={Droplet} label="Blood Group">
            {patient.bloodGroup ?? 'Not recorded'}
          </Fact>

          <Fact icon={hasAllergies ? TriangleAlert : ShieldAlert} label="Allergies" alert={hasAllergies}>
            {hasAllergies ? (
              <span className="flex flex-wrap gap-1">
                {allergies.map((allergy) => (
                  <Badge
                    key={allergy.id}
                    variant={allergy.severity === 'severe' ? 'critical' : 'caution'}
                  >
                    {allergy.substance}
                  </Badge>
                ))}
              </span>
            ) : (
              'None known'
            )}
          </Fact>

          <Fact icon={CalendarCheck} label="Last Visit">
            {patient.lastVisitOn ? (
              <span className="block leading-tight">
                {formatDate(patient.lastVisitOn)}
                <span className="mt-0.5 block text-[11px] font-normal text-ink-muted">
                  {formatRelativeToNow(patient.lastVisitOn)}
                </span>
              </span>
            ) : (
              'First visit'
            )}
          </Fact>
        </div>
      </div>
    </section>
  )
}
