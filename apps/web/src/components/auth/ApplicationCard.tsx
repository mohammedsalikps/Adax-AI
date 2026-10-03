import type { Application } from '@adaxai/contracts'
import { ArrowRight, Check } from 'lucide-react'
import { useId } from 'react'
import { Link } from 'react-router'
import { APPLICATION_ENTRIES } from '../../lib/applications.ts'
import { APP_STYLE } from './appStyle.tsx'

/**
 * One application on the selector: who it is for, what it really offers, and
 * one way in. The description is guidance for people; it grants nothing. The
 * card is not itself a link: it has exactly one control, the button-styled
 * link at the foot, so keyboard and screen-reader users meet it once.
 */
export function ApplicationCard({ application }: { application: Application }) {
  const entry = APPLICATION_ENTRIES[application]
  const { Icon, tile, accent } = APP_STYLE[application]
  const headingId = useId()
  return (
    <article aria-labelledby={headingId} className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition-shadow focus-within:shadow-pop hover:shadow-pop" data-testid={`application-${application}`}>
      <div aria-hidden="true" className={`h-1.5 ${accent}`} />
      <div className="flex flex-1 flex-col gap-5 p-6 sm:p-7">
        <span aria-hidden="true" className={`flex size-12 items-center justify-center rounded-xl ${tile}`}>
          <Icon className="size-6" />
        </span>
        <div className="space-y-1">
          <h2 id={headingId} className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
            {entry.label}
          </h2>
          <p className="text-xl font-semibold tracking-tight">{entry.audience}</p>
        </div>
        <ul className="flex-1 space-y-2.5 text-sm" aria-label={`What the ${entry.label} offers`}>
          {entry.capabilities.map((c) => (
            <li key={c} className="flex gap-2.5">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ok" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
        <Link
          to={entry.path}
          className="inline-flex min-h-control w-full items-center justify-center gap-2 rounded-md border border-brand bg-brand px-4 text-sm font-medium text-white shadow-card transition-colors hover:border-brand-strong hover:bg-brand-strong"
        >
          {entry.cta}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </article>
  )
}
