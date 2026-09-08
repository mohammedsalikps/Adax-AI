import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface SkeletonProps {
  className?: string
}

/** Neutral placeholder block. Pair with explicit width/height classes. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={cn('block animate-pulse rounded bg-surface-sunken', className)}
    />
  )
}

export type LoadingVariant = 'spinner' | 'skeleton'

export interface LoadingStateProps {
  variant?: LoadingVariant
  /** Announced to assistive technology; also shown beside the spinner. */
  label?: string
  /** Number of placeholder lines when variant is "skeleton". */
  rows?: number
  className?: string
}

export function LoadingState({
  variant = 'spinner',
  label = 'Loading',
  rows = 3,
  className,
}: LoadingStateProps) {
  if (variant === 'skeleton') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn('flex w-full flex-col gap-2.5 p-3.5', className)}
      >
        <span className="sr-only">{label}</span>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-2.5 w-1/3" />
              <Skeleton className="h-2.5 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn(
        'flex items-center justify-center gap-2 px-6 py-10 text-ink-muted',
        className,
      )}
    >
      <Loader2 size={16} className="animate-spin" aria-hidden />
      <span className="text-xs font-medium">{label}</span>
    </div>
  )
}
