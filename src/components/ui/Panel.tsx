import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export type PanelTone = 'default' | 'accent' | 'critical' | 'ai'

/** Header tint only — the body always stays on a neutral surface so that
 *  clinical content is never rendered on a coloured background. */
const TONE_HEADER_CLASSES: Record<PanelTone, string> = {
  default: 'bg-surface-alt',
  accent: 'bg-accent-soft',
  critical: 'bg-critical-soft',
  ai: 'bg-ai-soft',
}

const TONE_ICON_CLASSES: Record<PanelTone, string> = {
  default: 'text-ink-muted',
  accent: 'text-accent-ink',
  critical: 'text-critical',
  ai: 'text-ai',
}

export interface PanelProps {
  title?: ReactNode
  description?: ReactNode
  icon?: LucideIcon
  /** Buttons or badges aligned to the right of the header. */
  actions?: ReactNode
  footer?: ReactNode
  tone?: PanelTone
  /** Tighter body padding for dense clinical lists. */
  dense?: boolean
  /** Body scrolls internally instead of growing the page. */
  scrollable?: boolean
  /** Removes body padding, e.g. when embedding a Table. */
  flush?: boolean
  className?: string
  bodyClassName?: string
  children?: ReactNode
}

/**
 * Titled clinical region: a header bar with optional actions, a body that can
 * scroll independently, and an optional footer. This is the container the
 * consultation dashboard columns are built from.
 */
export function Panel({
  title,
  description,
  icon: Icon,
  actions,
  footer,
  tone = 'default',
  dense = false,
  scrollable = false,
  flush = false,
  className,
  bodyClassName,
  children,
}: PanelProps) {
  const hasHeader = Boolean(title || actions)

  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-panel border border-line bg-surface',
        scrollable && 'min-h-0',
        className,
      )}
    >
      {hasHeader && (
        <header
          className={cn(
            'flex flex-wrap items-center gap-2.5 border-b border-line px-3.5 py-2.5',
            TONE_HEADER_CLASSES[tone],
          )}
        >
          {Icon && (
            <Icon size={15} className={cn('shrink-0', TONE_ICON_CLASSES[tone])} aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="truncate text-[13px] font-semibold tracking-tight text-ink">
                {title}
              </h2>
            )}
            {description && (
              <p className="truncate text-[11px] text-ink-muted">{description}</p>
            )}
          </div>
          {actions && (
            // min-w-0 lets this shrink below its content width on narrow
            // screens, which is what allows a scrollable child (e.g. the
            // segmented Tabs strip) to actually engage its own overflow-x
            // instead of being clipped by the panel.
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">{actions}</div>
          )}
        </header>
      )}

      <div
        className={cn(
          'flex-1',
          !flush && (dense ? 'p-2.5' : 'p-4'),
          scrollable && 'min-h-0 overflow-y-auto',
          bodyClassName,
        )}
      >
        {children}
      </div>

      {footer && (
        <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-surface-alt px-3.5 py-2.5">
          {footer}
        </footer>
      )}
    </section>
  )
}
