import { cn } from '@/lib/cn'

export interface DividerProps {
  orientation?: 'horizontal' | 'vertical'
  /** Optional centred caption, e.g. a date separator in a timeline. */
  label?: string
  className?: string
}

export function Divider({
  orientation = 'horizontal',
  label,
  className,
}: DividerProps) {
  if (orientation === 'vertical') {
    return (
      <span
        role="separator"
        aria-orientation="vertical"
        className={cn('inline-block w-px shrink-0 self-stretch bg-line', className)}
      />
    )
  }

  if (label) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <span aria-hidden className="h-px flex-1 bg-line" />
        <span className="text-[10px] font-semibold tracking-wider text-ink-muted uppercase">
          {label}
        </span>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
    )
  }

  return (
    <hr
      className={cn('h-px w-full border-0 bg-line', className)}
    />
  )
}
