import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  /** Usually a Button that resolves the empty condition. */
  action?: ReactNode
  size?: 'sm' | 'md'
  className?: string
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  size = 'md',
  className,
}: EmptyStateProps) {
  const isSmall = size === 'sm'

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        isSmall ? 'gap-1.5 px-4 py-6' : 'gap-2 px-6 py-12',
        className,
      )}
    >
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-surface-sunken text-ink-muted',
          isSmall ? 'size-8' : 'size-11',
        )}
      >
        <Icon size={isSmall ? 15 : 19} aria-hidden />
      </div>
      <p
        className={cn(
          'font-semibold text-ink',
          isSmall ? 'text-[13px]' : 'mt-1 text-sm',
        )}
      >
        {title}
      </p>
      {description && (
        <p className="max-w-xs text-xs text-ink-muted">{description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
