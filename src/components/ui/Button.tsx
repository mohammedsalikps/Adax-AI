import type { ButtonHTMLAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-ink-inverse hover:bg-accent-hover',
  secondary:
    'border border-line bg-surface text-ink hover:border-line-strong hover:bg-surface-sunken',
  ghost: 'text-ink-soft hover:bg-surface-sunken hover:text-ink',
  danger: 'bg-critical text-white hover:bg-critical/90',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3.5 text-[13px]',
  lg: 'h-10 gap-2 px-4 text-sm',
}

const ICON_ONLY_CLASSES: Record<ButtonSize, string> = {
  sm: 'w-8 px-0',
  md: 'w-9 px-0',
  lg: 'w-10 px-0',
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 15, lg: 16 }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Swaps the icon for a spinner and blocks interaction. */
  loading?: boolean
  icon?: LucideIcon
  iconPosition?: 'left' | 'right'
  /** Square button with no label — requires aria-label. */
  iconOnly?: boolean
  fullWidth?: boolean
  children?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconPosition = 'left',
  iconOnly = false,
  fullWidth = false,
  type = 'button',
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const iconSize = ICON_SIZE[size]
  const showLeadingIcon = !loading && Icon && iconPosition === 'left'
  const showTrailingIcon = !loading && Icon && iconPosition === 'right'

  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control font-semibold whitespace-nowrap transition-colors',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        iconOnly && ICON_ONLY_CLASSES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 size={iconSize} className="animate-spin" aria-hidden />}
      {showLeadingIcon && Icon && <Icon size={iconSize} aria-hidden />}
      {!iconOnly && children}
      {showTrailingIcon && Icon && <Icon size={iconSize} aria-hidden />}
    </button>
  )
}
