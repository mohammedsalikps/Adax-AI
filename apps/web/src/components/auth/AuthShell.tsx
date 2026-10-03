import type { Application } from '@adaxai/contracts'
import { ArrowLeft, Info } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { APPLICATION_ENTRIES } from '../../lib/applications.ts'
import { ApplicationBadge } from './ApplicationBadge.tsx'

/**
 * The frame of every page a signed-out person sees: the product mark, the
 * page, and the development notice. One frame for the application selector,
 * the three sign-in pages, activation and the password change, so they read as
 * one product.
 */
export function AuthShell({ children, wide = false, hideBrand = false }: { children: ReactNode; wide?: boolean; hideBrand?: boolean }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-pop">
        Skip to main content
      </a>
      <header className="mx-auto flex w-full max-w-6xl items-center px-4 py-5 sm:px-8">
        {hideBrand ? (
          <div className="h-8" />
        ) : (
          <Link to="/login" className="flex items-center gap-2.5 rounded-md">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-base font-semibold tracking-tight">ADAXAI</span>
            <span className="sr-only">: all applications</span>
          </Link>
        )}
      </header>
      <main id="main" tabIndex={-1} className={`mx-auto flex w-full flex-1 flex-col px-4 pb-10 focus:outline-none sm:px-8 ${wide ? 'max-w-6xl' : 'max-w-md items-stretch justify-start pt-4 sm:pt-10'}`}>
        {children}
      </main>
      <footer className="px-4 pb-6">
        <p role="note" className="mx-auto flex max-w-xl items-start justify-center gap-2 text-center text-xs text-ink-muted">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>Development build · Synthetic data only · Not for clinical use · Not a medical device</span>
        </p>
      </footer>
    </div>
  )
}

/** The heading of a sign-in or activation page: the product, the portal's name, its application badge and one line. */
export function AuthHeader({ title, subtitle, application }: { title: string; subtitle?: ReactNode; application?: Application }) {
  return (
    <div className="mb-6 flex flex-col items-center gap-3 text-center">
      {application && <ApplicationBadge application={application} />}
      <div>
        <p className="text-sm font-semibold tracking-wide text-ink-muted uppercase">ADAXAI</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ink-muted sm:text-base">{subtitle}</p>}
      </div>
    </div>
  )
}

/** The way out of a sign-in page: back to the application selector. */
export function BackToApplications({ application }: { application?: Application }) {
  return (
    <Link to="/login" className="mb-5 inline-flex min-h-control items-center gap-2 self-start rounded-md px-1 text-sm font-medium text-brand-strong hover:underline">
      <ArrowLeft aria-hidden="true" className="size-4" />
      All applications
      {application && <span className="sr-only"> (leave the {APPLICATION_ENTRIES[application].label} sign-in)</span>}
    </Link>
  )
}
