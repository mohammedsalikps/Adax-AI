import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { SystemStatusPanel } from '../components/SystemStatusPanel.tsx'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'
import { PORTALS } from '../lib/portals.ts'

export function HomePage() {
  useDocumentTitle('Home')
  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">ADAXAI workspace</h1>
        <p className="max-w-2xl text-ink-muted">
          One platform with separate portals for each role. Portals open once sign-in is available; this build checks that the platform
          services are running.
        </p>
      </div>

      <section aria-labelledby="portals-heading" className="space-y-4">
        <h2 id="portals-heading" className="text-lg font-semibold">
          Portals
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PORTALS.map(({ id, path, title, audience, icon: Icon }) => (
            <li key={id}>
              <Link
                to={path}
                className="group flex h-full flex-col gap-3 rounded-xl border border-line bg-surface p-5 hover:border-brand hover:shadow-sm"
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-brand-soft text-brand-strong">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <span className="text-base font-semibold">{title} portal</span>
                <span className="text-sm text-ink-muted">{audience}</span>
                <span className="mt-auto inline-flex items-center gap-1 text-sm font-medium text-brand-strong">
                  Not yet available
                  <ArrowRight aria-hidden="true" className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <SystemStatusPanel />
    </div>
  )
}
