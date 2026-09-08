import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { VitalStatus } from '@/types/vitals'

const STATUS_VALUE_CLASSES: Record<VitalStatus, string> = {
  normal: 'text-ink',
  caution: 'text-caution',
  critical: 'text-critical',
}

export interface ClinicalDataRowProps {
  label: string
  value: ReactNode
  /** Colours the value for out-of-range readings. */
  status?: VitalStatus
  /** Secondary line beneath the value, e.g. a reference range. */
  hint?: string
  icon?: LucideIcon
  /** "inline" puts label and value on one line; "stacked" puts value below. */
  layout?: 'inline' | 'stacked'
  /** Tabular digits — use for any numeric measurement. */
  numeric?: boolean
  emphasis?: boolean
  dense?: boolean
  className?: string
}

/**
 * Label-and-value row, the building block of chart summaries, past-history
 * detail and prescription review lists.
 */
export function ClinicalDataRow({
  label,
  value,
  status,
  hint,
  icon: Icon,
  layout = 'inline',
  numeric = false,
  emphasis = false,
  dense = false,
  className,
}: ClinicalDataRowProps) {
  const valueClasses = cn(
    'text-[13px]',
    numeric && 'tnum',
    emphasis ? 'font-semibold' : 'font-medium',
    status ? STATUS_VALUE_CLASSES[status] : 'text-ink',
  )

  if (layout === 'stacked') {
    return (
      <div className={cn(dense ? 'py-1' : 'py-1.5', className)}>
        <div className="flex items-center gap-1.5">
          {Icon && <Icon size={12} className="shrink-0 text-ink-muted" aria-hidden />}
          <span className="text-[10px] font-semibold tracking-wider text-ink-muted uppercase">
            {label}
          </span>
        </div>
        <div className={cn('mt-0.5', valueClasses)}>{value}</div>
        {hint && <p className="mt-0.5 text-[11px] text-ink-muted">{hint}</p>}
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4',
        dense ? 'py-1' : 'py-1.5',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {Icon && <Icon size={13} className="shrink-0 text-ink-muted" aria-hidden />}
        <span className="truncate text-xs text-ink-soft">{label}</span>
      </div>
      <div className="min-w-0 text-right">
        <div className={cn('truncate', valueClasses)}>{value}</div>
        {hint && <p className="truncate text-[11px] text-ink-muted">{hint}</p>}
      </div>
    </div>
  )
}
