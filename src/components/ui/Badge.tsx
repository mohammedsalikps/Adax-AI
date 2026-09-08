import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

export type BadgeVariant =
  | 'neutral'
  | 'accent'
  | 'normal'
  | 'caution'
  | 'critical'
  | 'ai'

export type BadgeSize = 'sm' | 'md'

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'border-line bg-surface-sunken text-ink-soft',
  accent: 'border-accent/25 bg-accent-soft text-accent-ink',
  normal: 'border-normal/25 bg-normal-soft text-normal',
  caution: 'border-caution/25 bg-caution-soft text-caution',
  critical: 'border-critical/25 bg-critical-soft text-critical',
  ai: 'border-ai/25 bg-ai-soft text-ai',
}

const DOT_CLASSES: Record<BadgeVariant, string> = {
  neutral: 'bg-ink-muted',
  accent: 'bg-accent',
  normal: 'bg-normal',
  caution: 'bg-caution',
  critical: 'bg-critical',
  ai: 'bg-ai',
}

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 'h-5 gap-1 px-1.5 text-[10px]',
  md: 'h-6 gap-1.5 px-2 text-[11px]',
}

export interface BadgeProps {
  variant?: BadgeVariant
  size?: BadgeSize
  /** Leading status dot — use for live states rather than decoration. */
  dot?: boolean
  icon?: LucideIcon
  className?: string
  children: ReactNode
}

export function Badge({
  variant = 'neutral',
  size = 'sm',
  dot = false,
  icon: Icon,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-semibold whitespace-nowrap',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
    >
      {dot && (
        <span
          aria-hidden
          className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASSES[variant])}
        />
      )}
      {Icon && <Icon size={size === 'sm' ? 11 : 12} className="shrink-0" aria-hidden />}
      {children}
    </span>
  )
}
