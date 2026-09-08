import type { ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface FieldProps {
  /** id of the control this label points at. */
  htmlFor: string
  label?: string
  /** Helper text shown when there is no error. */
  hint?: string
  /** Replaces the hint and switches the control to its error styling. */
  error?: string
  required?: boolean
  className?: string
  children: ReactNode
}

/**
 * Label + control + hint/error wrapper used by every form primitive, so
 * validation messaging is identical across the application.
 * Shared control classes live in ./controlStyles.
 */
export function Field({
  htmlFor,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-semibold tracking-wide text-ink-soft uppercase"
        >
          {label}
          {required && (
            <span className="ml-0.5 text-critical" aria-hidden>
              *
            </span>
          )}
        </label>
      )}

      {children}

      {error ? (
        <p
          id={`${htmlFor}-error`}
          role="alert"
          className="flex items-center gap-1 text-[11px] font-medium text-critical"
        >
          <CircleAlert size={12} className="shrink-0" aria-hidden />
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${htmlFor}-hint`} className="text-[11px] text-ink-muted">
            {hint}
          </p>
        )
      )}
    </div>
  )
}
