import type { ReactNode } from 'react'

export interface Segment<T extends string> {
  value: T
  label: ReactNode
}

/**
 * A short row of mutually exclusive choices (a view, a scope). Each is a
 * toggle button whose pressed state is announced; for filtering a list, not
 * for navigating between pages (use links for that).
 */
export function SegmentedControl<T extends string>({ label, value, onChange, options, className = '' }: { label: string; value: T; onChange: (v: T) => void; options: Segment<T>[]; className?: string }) {
  return (
    <div role="group" aria-label={label} className={`inline-flex max-w-full flex-wrap rounded-lg border border-line bg-surface p-1 shadow-card ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`min-h-9 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors ${value === o.value ? 'bg-brand-soft text-brand-strong' : 'text-ink-muted hover:bg-canvas hover:text-ink'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
