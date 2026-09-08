import { TriangleAlert, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { AllergySeverity } from '@/types/patient'

const SEVERITY_CLASSES: Record<AllergySeverity, string> = {
  mild: 'border-line bg-surface-sunken text-ink-soft',
  moderate: 'border-caution/30 bg-caution-soft text-caution',
  severe: 'border-critical/35 bg-critical-soft text-critical',
}

const SEVERITY_LABEL: Record<AllergySeverity, string> = {
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
}

export interface AllergyChipProps {
  substance: string
  severity: AllergySeverity
  /** Shown in the native tooltip and to assistive technology. */
  reaction?: string
  size?: 'sm' | 'md'
  onRemove?: () => void
  className?: string
}

/**
 * A single known allergy. Severe allergies always render in the critical
 * colour so they remain identifiable at a glance on a busy chart.
 */
export function AllergyChip({
  substance,
  severity,
  reaction,
  size = 'md',
  onRemove,
  className,
}: AllergyChipProps) {
  const description = reaction
    ? `${substance} — ${SEVERITY_LABEL[severity]} — ${reaction}`
    : `${substance} — ${SEVERITY_LABEL[severity]}`

  return (
    <span
      title={description}
      className={cn(
        'inline-flex items-center rounded-full border font-semibold',
        size === 'sm' ? 'h-5 gap-1 px-1.5 text-[10px]' : 'h-6 gap-1.5 px-2 text-[11px]',
        SEVERITY_CLASSES[severity],
        className,
      )}
    >
      {severity === 'severe' && (
        <TriangleAlert size={size === 'sm' ? 10 : 12} className="shrink-0" aria-hidden />
      )}
      {substance}
      <span className="font-normal opacity-70">{SEVERITY_LABEL[severity]}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove allergy ${substance}`}
          className="-mr-0.5 shrink-0 rounded-full p-0.5 transition-opacity hover:opacity-70"
        >
          <X size={size === 'sm' ? 10 : 11} aria-hidden />
        </button>
      )}
      <span className="sr-only">{description}</span>
    </span>
  )
}
