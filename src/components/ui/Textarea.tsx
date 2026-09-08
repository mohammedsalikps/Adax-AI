import { useId } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { Field } from './Field'
import { CONTROL_BASE_CLASSES, controlBorderClasses } from './controlStyles'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  hint?: string
  error?: string
  /** Shows "n / maxLength" beneath the control. Requires maxLength. */
  showCount?: boolean
  resize?: 'none' | 'vertical'
  wrapperClassName?: string
}

export function Textarea({
  label,
  hint,
  error,
  showCount = false,
  resize = 'vertical',
  rows = 4,
  required,
  className,
  wrapperClassName,
  id,
  maxLength,
  value,
  ...rest
}: TextareaProps) {
  const generatedId = useId()
  const textareaId = id ?? generatedId
  const hasError = Boolean(error)
  const length = typeof value === 'string' ? value.length : 0

  return (
    <Field
      htmlFor={textareaId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <textarea
        id={textareaId}
        rows={rows}
        required={required}
        maxLength={maxLength}
        value={value}
        aria-invalid={hasError || undefined}
        aria-describedby={
          hasError ? `${textareaId}-error` : hint ? `${textareaId}-hint` : undefined
        }
        className={cn(
          CONTROL_BASE_CLASSES,
          controlBorderClasses(hasError),
          'min-h-[72px] px-3 py-2 text-[13px] leading-relaxed',
          resize === 'none' ? 'resize-none' : 'resize-y',
          className,
        )}
        {...rest}
      />
      {showCount && maxLength !== undefined && (
        <p className="tnum -mt-0.5 text-right text-[11px] text-ink-muted">
          {length} / {maxLength}
        </p>
      )}
    </Field>
  )
}
