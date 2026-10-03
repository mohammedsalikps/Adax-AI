import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'md' | 'sm'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand text-white border border-brand shadow-card hover:border-brand-strong hover:bg-brand-strong',
  secondary: 'bg-surface text-ink border border-line-strong shadow-card hover:bg-canvas',
  danger: 'bg-down text-white border border-down shadow-card hover:brightness-95',
  ghost: 'bg-transparent text-ink-muted border border-transparent hover:bg-canvas hover:text-ink',
}
const SIZES: Record<Size, string> = { md: 'min-h-control px-4 text-sm', sm: 'min-h-control-sm px-3 text-sm' }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'primary', size = 'md', loading, icon, disabled, className = '', children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  )
}
