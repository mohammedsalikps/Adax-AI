import { cn } from '@/lib/cn'
import type { VitalStatus } from '@/types/vitals'

const STROKE: Record<VitalStatus, string> = {
  normal: 'stroke-normal',
  caution: 'stroke-caution',
  critical: 'stroke-critical',
}

const FILL: Record<VitalStatus, string> = {
  normal: 'fill-normal/10',
  caution: 'fill-caution/10',
  critical: 'fill-critical/10',
}

/** Below this many points a line would imply a trend that is not there. */
export const MIN_SPARKLINE_POINTS = 3

export interface SparklineProps {
  /** Recorded values, oldest first. */
  values: number[]
  status?: VitalStatus
  /** Describes the trend for assistive tech; the drawing is decorative. */
  label: string
  className?: string
}

/**
 * Trend of previously recorded readings for one measurement.
 *
 * These are real recorded values from the patient's history, not a live
 * signal — the application captures no device stream. Renders nothing below
 * MIN_SPARKLINE_POINTS, because two points drawn as a line read as a trend
 * that a single pair of readings cannot support.
 */
export function Sparkline({ values, status = 'normal', label, className }: SparklineProps) {
  if (values.length < MIN_SPARKLINE_POINTS) return null

  const width = 100
  const height = 28
  const pad = 2

  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1

  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - pad - ((value - min) / span) * (height - pad * 2)
    return [x, y] as const
  })

  const line = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} ${width},${height} 0,${height}`

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-7 w-full', className)}
    >
      <polygon points={area} className={FILL[status]} stroke="none" />
      <polyline
        points={line}
        fill="none"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        className={STROKE[status]}
      />
    </svg>
  )
}
