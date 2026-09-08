import { useId } from 'react'
import type { SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Field } from './Field'
import {
  CONTROL_BASE_CLASSES,
  CONTROL_SIZE_CLASSES,
  controlBorderClasses,
  type ControlSize,
} from './controlStyles'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'children'> {
  label?: string
  hint?: string
  error?: string
  size?: ControlSize
  options: SelectOption[]
  /** Shown as a disabled first option when the value is empty. */
  placeholder?: string
  wrapperClassName?: string
}

export function Select({
  label,
  hint,
  error,
  size = 'md',
  options,
  placeholder,
  required,
  className,
  wrapperClassName,
  id,
  ...rest
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? generatedId
  const hasError = Boolean(error)

  return (
    <Field
      htmlFor={selectId}
      label={label}
      hint={hint}
      error={error}
      required={required}
      className={wrapperClassName}
    >
      <div className="relative flex items-center">
        <select
          id={selectId}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={
            hasError ? `${selectId}-error` : hint ? `${selectId}-hint` : undefined
          }
          className={cn(
            CONTROL_BASE_CLASSES,
            CONTROL_SIZE_CLASSES[size],
            controlBorderClasses(hasError),
            'appearance-none pr-9',
            className,
          )}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={15}
          aria-hidden
          className="pointer-events-none absolute right-3 text-ink-muted"
        />
      </div>
    </Field>
  )
}
