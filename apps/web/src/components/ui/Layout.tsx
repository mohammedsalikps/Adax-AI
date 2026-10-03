import type { LucideIcon } from 'lucide-react'
import { type ReactNode, useId } from 'react'

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

/** A titled section (the design's SectionCard); its heading names the region for assistive technology. */
export function Card({ title, actions, children, className = '', bodyClassName = 'p-5' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  const headingId = useId()
  return (
    <section aria-labelledby={title ? headingId : undefined} className={`min-w-0 rounded-xl border border-line bg-surface shadow-card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3.5">
          {title && (
            <h2 id={headingId} className="text-base font-semibold">
              {title}
            </h2>
          )}
          {actions}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  )
}

const STAT_TONES = { brand: 'bg-brand-soft text-brand', ok: 'bg-ok-soft text-ok', warn: 'bg-pending-soft text-pending', neutral: 'bg-canvas text-ink-muted' } as const

/**
 * One number that matters, with its label. Put several in a `<ul>`. While the
 * number is loading it shows a dash, never a made-up zero.
 */
export function StatCard({ label, value, icon: Icon, tone = 'brand', hint, loading }: { label: string; value: number | string | undefined; icon: LucideIcon; tone?: keyof typeof STAT_TONES; hint?: ReactNode; loading?: boolean }) {
  return (
    <li className="flex items-start gap-4 rounded-xl border border-line bg-surface p-4 shadow-card" aria-busy={loading || undefined}>
      <span aria-hidden="true" className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${STAT_TONES[tone]}`}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm text-ink-muted">{label}</p>
        <p className="text-stat font-semibold tabular-nums">{loading || value === undefined ? (
            <>
              <span aria-hidden="true">–</span>
              <span className="sr-only">Not loaded yet</span>
            </>
          ) : (
            value
          )}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-muted">{hint}</p>}
      </div>
    </li>
  )
}

/** Label/value pairs. */
export function DescriptionList({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs font-medium text-ink-muted uppercase">{k}</dt>
          <dd className="mt-0.5 break-words">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
