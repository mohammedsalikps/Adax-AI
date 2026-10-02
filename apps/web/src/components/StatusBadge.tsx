import { CircleCheck, CircleHelp, CircleX, LoaderCircle } from 'lucide-react'

export type BadgeState = 'up' | 'down' | 'checking' | 'unknown'

const STYLES: Record<BadgeState, { label: string; className: string; Icon: typeof CircleCheck }> = {
  up: { label: 'Operational', className: 'bg-ok-soft text-ok', Icon: CircleCheck },
  down: { label: 'Unavailable', className: 'bg-down-soft text-down', Icon: CircleX },
  checking: { label: 'Checking…', className: 'bg-pending-soft text-pending', Icon: LoaderCircle },
  unknown: { label: 'Unknown', className: 'bg-canvas text-ink-muted', Icon: CircleHelp },
}

/** Status is conveyed by text and icon, with colour as a secondary cue. */
export function StatusBadge({ state }: { state: BadgeState }) {
  const { label, className, Icon } = STYLES[state]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium ${className}`}>
      <Icon aria-hidden="true" className={`size-4 ${state === 'checking' ? 'animate-spin' : ''}`} />
      {label}
    </span>
  )
}
