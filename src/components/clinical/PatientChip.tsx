import { cn } from '@/lib/cn'
import { Avatar } from '@/components/ui/Avatar'
import type { Sex } from '@/types/patient'

const SEX_SHORT: Record<Sex, string> = { male: 'M', female: 'F', other: 'O' }

export interface PatientChipProps {
  patientId: string
  fullName: string
  photoUrl?: string
  age?: number
  sex?: Sex
  size?: 'sm' | 'md'
  /** Renders as a button and adds hover/selected affordances. */
  onClick?: () => void
  selected?: boolean
  className?: string
}

/** Compact patient reference for lists, queues and search results. */
export function PatientChip({
  patientId,
  fullName,
  photoUrl,
  age,
  sex,
  size = 'md',
  onClick,
  selected = false,
  className,
}: PatientChipProps) {
  const isSmall = size === 'sm'
  const demographics = [
    age !== undefined ? `${age}y` : null,
    sex ? SEX_SHORT[sex] : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const content = (
    <>
      {/* Decorative: the patient's name is rendered immediately beside it. */}
      <Avatar src={photoUrl} name={fullName} size={isSmall ? 'xs' : 'sm'} decorative />
      <span className="min-w-0 text-left">
        <span className="block truncate text-[13px] font-semibold text-ink">
          {fullName}
        </span>
        <span className="tnum block truncate text-[11px] text-ink-muted">
          {patientId}
          {demographics && ` · ${demographics}`}
        </span>
      </span>
    </>
  )

  const shared = cn(
    'inline-flex min-w-0 items-center gap-2 rounded-control',
    isSmall ? 'p-1' : 'p-1.5',
    className,
  )

  if (!onClick) {
    return <span className={shared}>{content}</span>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        shared,
        'transition-colors',
        selected ? 'bg-accent-soft' : 'hover:bg-surface-sunken',
      )}
    >
      {content}
    </button>
  )
}
