import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'
import type { Portal } from '../lib/portals.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

export function PortalPage({ portal }: { portal: Portal }) {
  useDocumentTitle(`${portal.title} portal`)
  const { title, audience, planned, icon: Icon } = portal
  return (
    <div className="max-w-2xl space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-brand-strong hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to home
      </Link>
      <div className="flex items-center gap-3">
        <span className="flex size-12 items-center justify-center rounded-xl bg-brand-soft text-brand-strong">
          <Icon aria-hidden="true" className="size-6" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title} portal</h1>
          <p className="text-ink-muted">{audience}</p>
        </div>
      </div>
      <section aria-labelledby="planned-heading" className="rounded-xl border border-line bg-surface p-5">
        <h2 id="planned-heading" className="font-semibold">
          Not yet available
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          This portal opens after sign-in is implemented. Planned for this portal in the MVP:
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
          {planned.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
