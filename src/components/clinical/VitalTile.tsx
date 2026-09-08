import type { LucideIcon } from 'lucide-react'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { VitalStatus } from '@/types/vitals'
import { Sparkline } from './Sparkline'

export type VitalTrend = 'up' | 'down' | 'steady'

const STATUS_CONTAINER: Record<VitalStatus, string> = {
  normal: 'border-line bg-surface',
  caution: 'border-caution/35 bg-caution-soft/30',
  critical: 'border-critical/40 bg-critical-soft/35',
}

const STATUS_VALUE: Record<VitalStatus, string> = {
  normal: 'text-ink',
  caution: 'text-caution',
  critical: 'text-critical',
}

const STATUS_ICON_WRAP: Record<VitalStatus, string> = {
  normal: 'bg-accent-soft text-accent',
  caution: 'bg-caution-soft text-caution',
  critical: 'bg-critical-soft text-critical',
}

const STATUS_PILL: Record<VitalStatus, string> = {
  normal: 'border-normal/25 bg-normal-soft text-normal',
  caution: 'border-caution/25 bg-caution-soft text-caution',
  critical: 'border-critical/25 bg-critical-soft text-critical',
}

/** Text label so status is never communicated by colour alone. */
const STATUS_WORD: Record<VitalStatus, string> = {
  normal: 'Normal',
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
   *  no status at all rather than implying the reading was assessed. */
  status?: VitalStatus
  trend?: VitalTrend
  /** Secondary line, e.g. "Normal 60–100" or a capture timestamp. */
  hint?: string
  /** Previously recorded values, oldest first, drawn as a trend line. */
  series?: number[]
  icon?: LucideIcon
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Single health reading. Colour is driven by clinical status only, and digits
 * are tabular so the value does not shift as it updates.
 *
 * The trend line, when shown, plots previously recorded readings from the
 * patient's history. Nothing here is a live device signal.
 */
export function VitalTile({
  label,
  value,
  unit,
  status,
  trend,
  hint,
  series,
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
        'flex flex-col rounded-control border',
        isSmall ? 'gap-1 p-2.5' : 'gap-1.5 p-3',
        STATUS_CONTAINER[tone],
        className,
      )}
    >
      <div className="flex items-center gap-2">
        {Icon && (
          <span
            aria-hidden
            className={cn(
              'flex shrink-0 items-center justify-center rounded-full',
              isSmall ? 'size-6' : 'size-7',
              status ? STATUS_ICON_WRAP[tone] : 'bg-surface-sunken text-ink-muted',
            )}
          >
            <Icon size={isSmall ? 12 : 14} />
          </span>
        )}
        {/* Wraps rather than truncates: a clipped vital label is unreadable
            at narrow widths, and these labels are short enough to wrap. */}
        <span className="text-[10px] leading-tight font-semibold tracking-wide text-ink-muted uppercase">
          {label}
        </span>
        {TrendIcon && (
          <TrendIcon size={13} className="ml-auto shrink-0 text-ink-muted" aria-hidden />
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
      </div>

      {series && series.length > 0 && (
        <Sparkline
          values={series}
          status={tone}
          label={`${label} trend across previously recorded readings`}
        />
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-0.5">
        {status && (
          <span
            className={cn(
              'inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-semibold',
              STATUS_PILL[status],
            )}
          >
            {STATUS_WORD[status]}
          </span>
        )}
      </div>

      {hint && <p className="tnum truncate text-[10px] text-ink-muted">{hint}</p>}
      <span className="sr-only">
        {`${label}: ${value} ${unit ?? ''}${status ? `, ${STATUS_WORD[status]}` : ''}`}
      </span>
    </div>
  )
}
