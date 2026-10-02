import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'

type Tone = 'info' | 'success' | 'warning' | 'error'

const TONES: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'border-notice/20 bg-notice-soft text-notice', Icon: Info },
  success: { cls: 'border-ok/20 bg-ok-soft text-ok', Icon: CircleCheck },
  warning: { cls: 'border-pending/20 bg-pending-soft text-pending', Icon: TriangleAlert },
  error: { cls: 'border-down/20 bg-down-soft text-down', Icon: CircleAlert },
}

export function Alert({ tone = 'info', title, children, className = '' }: { tone?: Tone; title?: ReactNode; children?: ReactNode; className?: string }) {
  const { cls, Icon } = TONES[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${cls} ${className}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  )
}

type BadgeTone = 'neutral' | 'brand' | 'ok' | 'warn' | 'down' | 'notice' | 'ai'
const BADGE: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-ink-muted border-line',
  brand: 'bg-brand-soft text-brand-strong border-brand/20',
  ok: 'bg-ok-soft text-ok border-ok/20',
  warn: 'bg-pending-soft text-pending border-pending/20',
  down: 'bg-down-soft text-down border-down/20',
  notice: 'bg-notice-soft text-notice border-notice/20',
  ai: 'bg-ai-soft text-ai border-ai/30',
}

export function Badge({ tone = 'neutral', children, icon }: { tone?: BadgeTone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${BADGE[tone]}`}>
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

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-muted">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
