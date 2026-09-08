import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Adds hover affordance for cards that act as links or buttons. */
  interactive?: boolean
  children?: ReactNode
}

/** Generic surface container. For a titled clinical region, use Panel instead. */
export function Card({ interactive = false, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-panel border border-line bg-surface',
        interactive &&
          'cursor-pointer transition-colors hover:border-line-strong hover:bg-surface-alt',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-4 pt-4 pb-2', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-sm font-semibold tracking-tight text-ink', className)}
      {...rest}
    >
      {children}
    </h3>
  )
}

export function CardDescription({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn('mt-0.5 text-xs text-ink-muted', className)} {...rest}>
      {children}
    </p>
  )
}

export function CardContent({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-4 py-3', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-t border-line bg-surface-alt px-4 py-3',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
