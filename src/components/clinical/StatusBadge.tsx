import { Badge, type BadgeSize, type BadgeVariant } from '@/components/ui/Badge'

/** Every status the console can display, mapped to one consistent colour. */
export type ClinicalStatus =
  | 'normal'
  | 'caution'
  | 'critical'
  | 'waiting'
  | 'in-consultation'
  | 'completed'
  | 'ai-draft'
  | 'accepted'
  | 'rejected'

interface StatusPreset {
  variant: BadgeVariant
  label: string
  dot: boolean
}

const STATUS_PRESETS: Record<ClinicalStatus, StatusPreset> = {
  normal: { variant: 'normal', label: 'Normal', dot: true },
  caution: { variant: 'caution', label: 'Borderline', dot: true },
  critical: { variant: 'critical', label: 'Critical', dot: true },
  waiting: { variant: 'neutral', label: 'Waiting', dot: true },
  'in-consultation': { variant: 'accent', label: 'In consultation', dot: true },
  completed: { variant: 'normal', label: 'Completed', dot: false },
  'ai-draft': { variant: 'ai', label: 'AI draft', dot: false },
  accepted: { variant: 'normal', label: 'Accepted', dot: false },
  rejected: { variant: 'neutral', label: 'Rejected', dot: false },
}

export interface StatusBadgeProps {
  status: ClinicalStatus
  /** Overrides the preset wording, e.g. "Awaiting vitals". */
  label?: string
  size?: BadgeSize
  className?: string
}

/**
 * Single source of truth for clinical status colour. Screens must use this
 * rather than choosing Badge variants ad hoc, so a colour always means the
 * same thing across the application.
 */
export function StatusBadge({ status, label, size = 'sm', className }: StatusBadgeProps) {
  const preset = STATUS_PRESETS[status]

  return (
    <Badge variant={preset.variant} size={size} dot={preset.dot} className={className}>
      {label ?? preset.label}
    </Badge>
  )
}
