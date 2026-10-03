import type { Application } from '@adaxai/contracts'
import { APPLICATION_ENTRIES } from '../../lib/applications.ts'
import { APP_STYLE } from './appStyle.tsx'

/** Names the application a page belongs to ("Doctor App"), so a sign-in page can never be mistaken for another's. */
export function ApplicationBadge({ application }: { application: Application }) {
  const { Icon, badge } = APP_STYLE[application]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide whitespace-nowrap ${badge}`}>
      <Icon aria-hidden="true" className="size-3.5" />
      {APPLICATION_ENTRIES[application].label}
    </span>
  )
}
