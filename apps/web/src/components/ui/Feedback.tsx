import { CircleAlert, CircleCheck, Info, LoaderCircle, type LucideIcon, ShieldAlert, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { ApiError, errorMessage } from '../../lib/api.ts'
import { Button } from './Button.tsx'

type Tone = 'info' | 'success' | 'warning' | 'error'

const TONES: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'border-notice/20 bg-notice-soft text-notice', Icon: Info },
  success: { cls: 'border-ok/20 bg-ok-soft text-ok', Icon: CircleCheck },
  warning: { cls: 'border-pending/20 bg-pending-soft text-pending', Icon: TriangleAlert },
  error: { cls: 'border-down/20 bg-down-soft text-down', Icon: CircleAlert },
}

/** `live={false}`: no live-region role, for a message that sits in a log whose own live region says what arrived (so that a screen reader does not say it twice). */
export function Alert({ tone = 'info', title, children, className = '', live = true }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string; live?: boolean }) {
  const { cls, Icon } = TONES[tone]
  return (
    <div role={live ? (tone === 'error' ? 'alert' : 'status') : undefined} className={`flex gap-2 rounded-lg border px-3 py-2 text-sm ${cls} ${className}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  )
}

export type BadgeTone = 'neutral' | 'brand' | 'ok' | 'warn' | 'down' | 'notice' | 'ai'
const BADGE: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-ink-muted border-line',
  brand: 'bg-brand-soft text-brand-strong border-brand/20',
  ok: 'bg-ok-soft text-ok border-ok/20',
  warn: 'bg-pending-soft text-pending border-pending/20',
  down: 'bg-down-soft text-down border-down/20',
  notice: 'bg-notice-soft text-notice border-notice/20',
  ai: 'bg-ai-soft text-ai border-ai/30',
}

/**
 * A status pill: a soft tint, a text label and (for statuses) a dot. Colour is
 * never the only cue; the label always says it. Short labels stay on one line;
 * `wrap` lets long ones (names, dates) wrap on narrow screens.
 */
export function Badge({ tone = 'neutral', children, icon, wrap = false, dot = false }: { tone?: BadgeTone; children: ReactNode; icon?: ReactNode; wrap?: boolean; dot?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2.5 py-0.5 text-xs font-medium ${wrap ? 'rounded-md text-left [overflow-wrap:anywhere]' : 'rounded-full whitespace-nowrap'} ${BADGE[tone]}`}>
      {dot && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />}
      {icon}
      {children}
    </span>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <p role="status" className="flex items-center gap-2 py-6 text-sm text-ink-muted">
      <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      {label}
    </p>
  )
}

/** Placeholder rows while a list loads; announced once, quiet for assistive technology. */
export function LoadingState({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" className="space-y-3 py-1">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-line/60" />
      ))}
    </div>
  )
}

export function EmptyState({ title, children, action, icon: Icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: LucideIcon }) {
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-10 text-center">
      {Icon && (
        <span aria-hidden="true" className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-brand-soft text-brand">
          <Icon className="size-5" />
        </span>
      )}
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * A failed load: what went wrong, and a retry. A refusal (403) is different:
 * the person is told they do not have access, and there is nothing to retry.
 */
export function ErrorState({ title = 'This could not be loaded', error, onRetry, retrying }: { title?: string; error?: unknown; onRetry?: () => void; retrying?: boolean }) {
  const denied = error instanceof ApiError && error.status === 403
  const Icon = denied ? ShieldAlert : CircleAlert
  return (
    <div role="alert" className="rounded-xl border border-down/20 bg-down-soft/40 px-6 py-8 text-center">
      <Icon aria-hidden="true" className="mx-auto mb-2 size-6 text-down" />
      <p className="font-semibold text-down">{denied ? 'You do not have access to this' : title}</p>
      {error !== undefined && <p className="mx-auto mt-1 max-w-md text-sm text-ink">{errorMessage(error)}</p>}
      {onRetry && !denied && (
        <Button size="sm" variant="secondary" className="mt-4" loading={retrying} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
