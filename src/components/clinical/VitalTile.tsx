import type { LucideIcon } from 'lucide-react'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { VitalStatus } from '@/types/vitals'

export type VitalTrend = 'up' | 'down' | 'steady'

const STATUS_CONTAINER: Record<VitalStatus, string> = {
  normal: 'border-line bg-surface',
  caution: 'border-caution/35 bg-caution-soft/40',
  critical: 'border-critical/45 bg-critical-soft/50',
}

const STATUS_VALUE: Record<VitalStatus, string> = {
  normal: 'text-ink',
  caution: 'text-caution',
  critical: 'text-critical',
}

const STATUS_DOT: Record<VitalStatus, string> = {
  normal: 'bg-normal',
  caution: 'bg-caution',
  critical: 'bg-critical',
}

/** Text label so status is never communicated by colour alone. */
const STATUS_WORD: Record<VitalStatus, string | null> = {
  normal: null,
  caution: 'Borderline',
  critical: 'Out of range',
}

const TREND_ICON: Record<VitalTrend, LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  steady: Minus,
}

export interface VitalTileProps {
  label: string
  /** Pre-formatted so composite readings such as "128/84" work unchanged. */
  value: string | number
  unit?: string
  /** Omit for a measurement with no reference range — the tile then shows
   *  no status dot rather than implying the reading was assessed. */
  status?: VitalStatus
  trend?: VitalTrend
  /** Secondary line, e.g. "Normal 60–100" or a capture timestamp. */
  hint?: string
  icon?: LucideIcon
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Single live health reading. Colour is driven by clinical status only, and
 * digits are tabular so the value does not shift as it updates.
 */
export function VitalTile({
  label,
  value,
  unit,
  status,
  trend,
  hint,
  icon: Icon,
  size = 'md',
  className,
}: VitalTileProps) {
  const TrendIcon = trend ? TREND_ICON[trend] : null
  const isSmall = size === 'sm'
  const tone: VitalStatus = status ?? 'normal'

  return (
    <div
      className={cn(
        'flex flex-col justify-between rounded-control border',
        isSmall ? 'gap-1 p-2.5' : 'gap-1.5 p-3',
        STATUS_CONTAINER[tone],
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        {Icon && <Icon size={13} className="shrink-0 text-ink-muted" aria-hidden />}
        {/* Wraps rather than truncates: a clipped vital label is unreadable
            at narrow widths, and these labels are short enough to wrap. */}
        <span className="text-[10px] leading-tight font-semibold tracking-wide text-ink-muted uppercase">
          {label}
        </span>
        {status && (
          <span
            aria-hidden
            className={cn('ml-auto size-1.5 shrink-0 rounded-full', STATUS_DOT[status])}
          />
        )}
      </div>

      <div className="flex items-baseline gap-1">
        <span
          className={cn(
            'tnum font-semibold tracking-tight',
            isSmall ? 'text-lg' : 'text-2xl',
            STATUS_VALUE[tone],
          )}
        >
          {value}
        </span>
        {unit && <span className="text-[11px] font-medium text-ink-muted">{unit}</span>}
        {TrendIcon && (
          <TrendIcon size={13} className="ml-auto shrink-0 text-ink-muted" aria-hidden />
        )}
      </div>

      {status && STATUS_WORD[status] && (
        <p className={cn('text-[10px] font-semibold', STATUS_VALUE[status])}>
          {STATUS_WORD[status]}
        </p>
      )}
      {hint && <p className="tnum truncate text-[10px] text-ink-muted">{hint}</p>}
      <span className="sr-only">
        {`${label}: ${value} ${unit ?? ''}${status ? `, ${status}` : ''}`}
      </span>
    </div>
  )
}
