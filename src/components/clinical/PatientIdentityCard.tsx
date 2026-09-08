import { TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import type { BloodGroup, Sex } from '@/types/patient'

const SEX_LABEL: Record<Sex, string> = { male: 'M', female: 'F', other: 'O' }

export interface PatientIdentityCardProps {
  patientId: string
  fullName: string
  age: number
  sex: Sex
  photoUrl?: string
  bloodGroup?: BloodGroup
  /** Rendered as a warning badge when greater than zero. */
  allergyCount?: number
  /** Opens the full patient profile. Wired to the photo and the name. */
  onOpenProfile?: () => void
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Persistent patient identity block. Placed top-right on the consultation
 * dashboard so the doctor can always see whose chart is open — clicking the
 * photo opens the full profile.
 */
export function PatientIdentityCard({
  patientId,
  fullName,
  age,
  sex,
  photoUrl,
  bloodGroup,
  allergyCount = 0,
  onOpenProfile,
  size = 'md',
  className,
}: PatientIdentityCardProps) {
  const isSmall = size === 'sm'

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-panel border border-line bg-surface',
        isSmall ? 'p-2.5' : 'p-3',
        className,
      )}
    >
      {onOpenProfile ? (
        <button
          type="button"
          onClick={onOpenProfile}
          aria-label={`Open profile for ${fullName}`}
          className="shrink-0 rounded-full transition-opacity hover:opacity-85"
        >
          <Avatar
            src={photoUrl}
            name={fullName}
            size={isSmall ? 'md' : 'lg'}
            decorative
            className="border-2 border-accent-soft"
          />
        </button>
      ) : (
        <Avatar src={photoUrl} name={fullName} size={isSmall ? 'md' : 'lg'} decorative />
      )}

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate font-semibold tracking-tight text-ink',
            isSmall ? 'text-[13px]' : 'text-sm',
          )}
        >
          {fullName}
        </p>
        <p className="tnum truncate text-xs text-ink-soft">
          {patientId} · {age}y · {SEX_LABEL[sex]}
          {bloodGroup && ` · ${bloodGroup}`}
        </p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {allergyCount > 0 ? (
            <Badge variant="critical" icon={TriangleAlert}>
              {allergyCount} {allergyCount === 1 ? 'allergy' : 'allergies'}
            </Badge>
          ) : (
            <Badge variant="normal">No known allergies</Badge>
          )}
        </div>
      </div>
    </div>
  )
}
