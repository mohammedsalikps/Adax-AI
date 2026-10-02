import { Info } from 'lucide-react'
import { Link, NavLink, Outlet, ScrollRestoration } from 'react-router'
import { PORTALS } from '../lib/portals.ts'

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap',
    isActive ? 'bg-brand-soft text-brand-strong' : 'text-ink-muted hover:bg-canvas hover:text-ink',
  ].join(' ')

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to main content
      </a>

      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 rounded-md">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-lg font-semibold tracking-tight">ADAXAI</span>
          </Link>
          <nav aria-label="Portals" className="-mx-1 flex gap-1 overflow-x-auto">
            <NavLink to="/" end className={navClass}>
              Home
            </NavLink>
            {PORTALS.map((p) => (
              <NavLink key={p.id} to={p.path} className={navClass}>
                {p.title}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <div role="note" className="border-b border-line bg-notice-soft text-notice">
        <p className="mx-auto flex max-w-6xl items-start gap-2 px-4 py-2 text-sm">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <strong className="font-semibold">Development build.</strong> Synthetic data only. Not for clinical use. Sign-in arrives in the next
            milestone.
          </span>
        </p>
      </div>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 focus:outline-none">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-ink-muted">
          ADAXAI MVP · Not a medical device · Not clinically validated
        </p>
      </footer>
      <ScrollRestoration />
    </div>
  )
}
