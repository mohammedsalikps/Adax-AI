import { useId } from 'react'
import type { InputHTMLAttributes, ReactNode, Ref } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Field } from './Field'
import {
  CONTROL_BASE_CLASSES,
  CONTROL_SIZE_CLASSES,
  controlBorderClasses,
  type ControlSize,
} from './controlStyles'

const ICON_INSET: Record<ControlSize, string> = {
  sm: 'pl-8',
  md: 'pl-9',
  lg: 'pl-10',
}

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** Forwarded to the native input (React 19 passes ref as a plain prop). */
  ref?: Ref<HTMLInputElement>
  label?: string
  hint?: string
  error?: string
  size?: ControlSize
  icon?: LucideIcon
  /** Rendered inside the control on the right, e.g. a unit such as "mg/dL". */
  suffix?: ReactNode
  /** Right-aligned tabular digits for numeric clinical entry. */
  numeric?: boolean
  wrapperClassName?: string
}

export function Input({
  label,
  hint,
  error,
  size = 'md',
  icon: Icon,
  suffix,
  numeric = false,
  required,
  className,
  wrapperClassName,
  id,
  ...rest
}: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hasError = Boolean(error)

  return (
    <Field
      htmlFor={inputId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <div className="relative flex items-center">
        {Icon && (
          <Icon
            size={15}
            aria-hidden
            className="pointer-events-none absolute left-3 text-ink-muted"
          />
        )}
        <input
          id={inputId}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={
            hasError ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
          }
          className={cn(
            CONTROL_BASE_CLASSES,
            CONTROL_SIZE_CLASSES[size],
            controlBorderClasses(hasError),
            Icon && ICON_INSET[size],
            suffix && 'pr-14',
            numeric && 'tnum',
            className,
          )}
          {...rest}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 text-[11px] font-medium text-ink-muted">
            {suffix}
          </span>
        )}
      </div>
    </Field>
  )
}
