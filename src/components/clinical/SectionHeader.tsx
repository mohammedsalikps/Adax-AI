import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SectionHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  /** Buttons or filters aligned right. */
  actions?: ReactNode
  /** Heading level, so page structure stays correct for screen readers. */
  as?: 'h2' | 'h3' | 'h4'
  size?: 'sm' | 'md' | 'lg'
  /** Adds a hairline rule beneath the header. */
  divided?: boolean
  className?: string
}

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'text-[13px]',
  md: 'text-sm',
  lg: 'text-base',
}

/** Titled heading for a region of a screen, outside of a Panel chrome. */
export function SectionHeader({
  title,
  description,
  icon: Icon,
  actions,
  as: Heading = 'h2',
  size = 'md',
  divided = false,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3',
        divided && 'border-b border-line pb-2.5',
        className,
      )}
    >
      {Icon && (
        <Icon size={16} className="mt-0.5 shrink-0 text-ink-muted" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        <Heading
          className={cn(
            'font-semibold tracking-tight text-ink',
            SIZE_CLASSES[size],
          )}
        >
          {title}
        </Heading>
        {description && (
          <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
